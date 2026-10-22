import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import { afterEach, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { ApiError } from "@/core/api/client";
import type { SurfaceTarget } from "@/core/paywalls/binding/targets";
import type { FrameworkSurface } from "@/core/paywalls/project/framework";
import { readLock, writeApp, writeBinding, type LockFile } from "@/core/paywalls/project/lock";
import { assertSourced, runPromote } from "@/core/paywalls/promote";
import type { CommandContext } from "@/program/command";
import { createCommandOutput } from "@/program/output";
import { useRenderer, type Renderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { writeFakeFrameworkProject } from "../../helpers/framework";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const target = {
  surface: { kind: "paywall" as const, id: "plus-upgrade", dir: "/tmp/p", configFile: "/tmp/p/config.ts", routes: [] },
  platform: "ios",
  applicationId: "42",
};

const lockWith = (sourcePending?: number): LockFile => ({
  version: 1,
  apps: { ios: "42" },
  paywalls: { "plus-upgrade": { ios: { paywallId: "208540", snapshot: "abc", sourcePending } } },
  funnels: {},
});

test("promote refuses the latest version while its source never landed, and says how to finish it", () => {
  assert.throws(
    () => assertSourced(lockWith(7), target, undefined),
    /plus-upgrade version 7 has no source yet — run `superwall push` to finish it, then promote\./,
  );
  assert.throws(() => assertSourced(lockWith(7), target, 7), /version 7 has no source yet/);
});

test("promote goes ahead once the source landed, or for a different version", () => {
  assertSourced(lockWith(), target, undefined);
  assertSourced(lockWith(7), target, 6);
  assertSourced(lockWith(7), { ...target, platform: "android" }, undefined);
});

const FAKE = {
  discover: "export const discoverProject = (root) => globalThis.__promote.discover(root);\n",
  preview: [
    "export const startPreviewServer = async () => ({});",
    "export const buildStudioProject = async () => globalThis.__promote.studio();",
    "",
  ].join("\n"),
};

interface Fake {
  calls: string[];
  bodies: Record<string, unknown>;
  live: Record<string, number>;
  promoted: Record<string, number>;
  promoteStatus?: number;
  paywalls: unknown[];
  projects: unknown[];
}

const dirs: string[] = [];
const servers: http.Server[] = [];
const savedEnv = { ...process.env };

afterEach(async () => {
  process.env = { ...savedEnv };
  selectRenderer({ mode: "text" });
  Reflect.deleteProperty(globalThis, "__promote");
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const surfaceOf = (id: string): FrameworkSurface => ({
  kind: "paywall",
  id,
  dir: `/tmp/${id}`,
  configFile: `/tmp/${id}/config.ts`,
  routes: [],
});

function project(ids: string[], platforms: Record<string, string[]> = {}): string {
  const root = writeFakeFrameworkProject(FAKE);
  dirs.push(root);
  Reflect.set(globalThis, "__promote", {
    discover: (dir: string) => ({
      root: dir,
      superwallDir: dir,
      marker: "package.json",
      surfaces: ids.map(surfaceOf),
      diagnostics: [],
    }),
    studio: () => ({
      surfaces: ids.map((id) => ({ kind: "paywall", id, products: {}, platforms: platforms[id] })),
    }),
  });
  return root;
}

async function startApi(over: Partial<Fake> = {}): Promise<Fake> {
  const fake: Fake = { calls: [], bodies: {}, live: {}, promoted: {}, paywalls: [], projects: [], ...over };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      const url = req.url ?? "";
      fake.calls.push(`${req.method} ${url}`);
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const promote = /^\/v2\/paywalls\/(\d+)\/promote$/.exec(url)?.[1];
      const live = /^\/v2\/paywalls\/(\d+)$/.exec(url)?.[1];
      if (promote !== undefined) {
        fake.bodies[promote] = JSON.parse(raw || "{}");
        if (fake.promoteStatus !== undefined) send(fake.promoteStatus, { message: "No such version." });
        else send(200, { version: fake.promoted[promote], url: "u" });
      } else if (live !== undefined) {
        send(200, { id: live, version: fake.live[live] });
      } else if (url.startsWith("/v2/paywalls?")) {
        send(200, { data: fake.paywalls, has_more: false });
      } else if (url.startsWith("/v2/projects")) {
        send(200, { data: fake.projects, has_more: false });
      } else {
        send(404, {});
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  process.env.SUPERWALL_API_KEY = "sk_test_promote";
  process.env.SUPERWALL_API_HOST = `http://127.0.0.1:${port}`;
  return fake;
}

function context(renderer: Renderer, interactive = false): CommandContext<"none"> {
  useRenderer(renderer);
  return {
    ui: renderer,
    output: createCommandOutput("text", renderer),
    outputMode: "text",
    interactive,
    installDir: process.cwd(),
    json: false,
    dryRun: false,
    target: {},
    fail: () => {
      process.exitCode = 1;
    },
  };
}

const said = (calls: RendererCall[], method: string): string[] =>
  calls.filter((call) => call.method === method).map((call) => stripVTControlCharacters(String(call.value)));

const input = (dir: string, flags: { id?: string[]; platform?: string[]; version?: number } = {}) => ({
  args: { dir },
  flags: { id: [], platform: [], version: undefined, ...flags },
});

function bound(ids: string[] = ["plus-upgrade"]): string {
  const root = project(ids);
  writeApp(root, "ios", "42");
  for (const [index, id] of ids.entries()) writeBinding(root, "paywall", id, "ios", { paywallId: `20854${index}` });
  return root;
}

test("promote makes the latest version live and says what moved", async () => {
  const api = await startApi({ live: { "208540": 6 }, promoted: { "208540": 7 } });
  const root = bound();
  const calls: RendererCall[] = [];

  await runPromote(context(recordingRenderer(calls)), input(root));

  assert.deepEqual(api.bodies, { "208540": {} });
  assert.match(said(calls, "intro")[0] ?? "", /^Superwall v/);
  assert.match(said(calls, "info")[0] ?? "", /^plus-upgrade\nPromoted version 6 → 7 /);
  assert.deepEqual(said(calls, "outro"), ["1 paywall live."]);
});

test("a version that is already live is counted, not reported as promoted", async () => {
  await startApi({ live: { "208540": 7 }, promoted: { "208540": 7 } });
  const root = bound();
  const calls: RendererCall[] = [];

  await runPromote(context(recordingRenderer(calls)), input(root));

  assert.match(said(calls, "info")[0] ?? "", /^plus-upgrade\nVersion 7 already live /);
  assert.deepEqual(said(calls, "outro"), ["Nothing to do · 1 already live."]);
});

test("the summary counts promoted and unchanged paywalls apart, in the plural", async () => {
  await startApi({
    live: { "208540": 1, "208541": 2, "208542": 3 },
    promoted: { "208540": 2, "208541": 3, "208542": 3 },
  });
  const root = bound(["a", "b", "c"]);
  const calls: RendererCall[] = [];

  await runPromote(context(recordingRenderer(calls)), input(root));

  assert.deepEqual(said(calls, "outro"), ["2 paywalls live · 1 already live."]);
});

test("--version is sent as asked, so an older version rolls back", async () => {
  const api = await startApi({ live: { "208540": 7 }, promoted: { "208540": 5 } });
  const root = bound();
  const calls: RendererCall[] = [];

  await runPromote(context(recordingRenderer(calls)), input(root, { version: 5 }));

  assert.deepEqual(api.bodies, { "208540": { version: 5 } });
  assert.match(said(calls, "info")[0] ?? "", /Rolled back version 7 → 5/);
});

test("--version must be a whole pushed version and target a single surface", async () => {
  const api = await startApi();
  const root = bound(["a", "b"]);
  const calls: RendererCall[] = [];

  await assert.rejects(
    runPromote(context(recordingRenderer(calls)), input(root, { id: ["a"], version: 2.5 })),
    /^Error: --version takes a pushed version number, e\.g\. --version 3\.$/,
  );
  await assert.rejects(
    runPromote(context(recordingRenderer(calls)), input(root, { version: 3 })),
    /^Error: --version targets one surface — combine it with a single --id <id>\.$/,
  );
  assert.deepEqual(api.calls, []);
  assert.deepEqual(said(calls, "intro"), []);
});

test("--version on a surface pushed to several platforms asks for --platform, which narrows it", async () => {
  const api = await startApi({ live: { "208540": 7, "208541": 7 }, promoted: { "208540": 3 } });
  const root = project(["plus-upgrade"], { "plus-upgrade": ["ios", "android"] });
  writeApp(root, "ios", "42");
  writeApp(root, "android", "43");
  writeBinding(root, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  writeBinding(root, "paywall", "plus-upgrade", "android", { paywallId: "208541" });
  const calls: RendererCall[] = [];

  await assert.rejects(
    runPromote(context(recordingRenderer(calls)), input(root, { version: 3 })),
    /--version targets one paywall — `plus-upgrade` is pushed to ios, android; add --platform <platform> to pick one\./,
  );
  assert.deepEqual(api.bodies, {});

  await runPromote(context(recordingRenderer(calls)), input(root, { version: 3, platform: ["ios"] }));
  assert.deepEqual(api.bodies, { "208540": { version: 3 } });
  assert.match(said(calls, "info")[0] ?? "", /^plus-upgrade/);
  assert.match(said(calls, "info")[0] ?? "", /ios/);
});

test("a version the API doesn't have hints at promoting the latest instead", async () => {
  await startApi({ live: { "208540": 7 }, promoteStatus: 404 });
  const root = bound();
  const calls: RendererCall[] = [];

  await assert.rejects(runPromote(context(recordingRenderer(calls)), input(root, { version: 9 })), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.hint, "Run `superwall promote` without --version to promote the latest.");
    return true;
  });
  await assert.rejects(runPromote(context(recordingRenderer(calls)), input(root)), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.equal(error.hint, undefined);
    return true;
  });
  assert.deepEqual(said(calls, "info"), ["plus-upgrade failed", "plus-upgrade failed"]);
});

test("a version whose source never landed is refused before anything is promoted", async () => {
  const api = await startApi({ live: { "208540": 6 }, promoted: { "208540": 7 } });
  const root = project(["plus-upgrade"]);
  writeApp(root, "ios", "42");
  writeBinding(root, "paywall", "plus-upgrade", "ios", { paywallId: "208540", snapshot: "abc", sourcePending: 7 });
  const calls: RendererCall[] = [];

  await assert.rejects(runPromote(context(recordingRenderer(calls)), input(root)), /version 7 has no source yet/);
  assert.ok(!api.calls.some((call) => call.includes("/promote")));
});

test("interactively, the app and an unbound paywall on it are asked for and saved to the lock", async () => {
  const api = await startApi({
    live: { "300": 1 },
    promoted: { "300": 2 },
    projects: [
      {
        id: "9",
        applications: [
          { id: 42, name: "Acme", platform: "ios" },
          { id: 44, name: "Acme Beta", platform: "ios" },
        ],
      },
    ],
    paywalls: [{ id: 300, identifier: "plus-upgrade", metadata: { headless: "true", headlessSurface: "plus-upgrade" } }],
  });
  const root = project(["plus-upgrade"], { "plus-upgrade": ["ios"] });
  const calls: RendererCall[] = [];
  const answers = ["44", "__adopt__"];
  const renderer: Renderer = {
    ...recordingRenderer(calls),
    select: async (options) => {
      calls.push({ method: "select", value: options.message });
      return answers.shift() ?? null;
    },
  };

  await runPromote(context(renderer, true), input(root));

  const asked = said(calls, "select");
  assert.match(asked[0] ?? "", /^Which iOS app do these paywalls push to\?/);
  assert.match(asked[1] ?? "", /^App 44 already has a paywall `plus-upgrade` \(300\)/);
  assert.deepEqual(readLock(root).apps, { ios: "44" });
  assert.deepEqual(readLock(root).paywalls["plus-upgrade"], { ios: { paywallId: "300" } });
  assert.ok(api.calls.includes("POST /v2/paywalls/300/promote"));
  assert.deepEqual(said(calls, "outro"), ["1 paywall live."]);
});

test("without a terminal an unbound paywall is never adopted silently", async () => {
  const api = await startApi({
    paywalls: [{ id: 300, identifier: "plus-upgrade", metadata: { headless: "true" } }],
  });
  const root = project(["plus-upgrade"]);
  writeApp(root, "ios", "42");
  const calls: RendererCall[] = [];

  await assert.rejects(
    runPromote(context(recordingRenderer(calls)), input(root)),
    /App 42 already has a paywall `plus-upgrade` \(300\) that superwall\.lock doesn't bind, so nothing was pushed\./,
  );
  assert.equal(calls.some((call) => call.method === "select"), false);
  assert.ok(!api.calls.some((call) => call.includes("/promote")));
});

test("a funnel's pending source is read from the funnels section", () => {
  const funnel: SurfaceTarget = { ...target, surface: { ...target.surface, kind: "funnel" } };
  const lock: LockFile = {
    version: 1,
    apps: { ios: "42" },
    paywalls: {},
    funnels: { "plus-upgrade": { ios: { paywallId: "208540", snapshot: "abc", sourcePending: 4 } } },
  };

  assert.throws(() => assertSourced(lock, funnel, undefined), /plus-upgrade version 4 has no source yet/);
  assertSourced(lockWith(7), funnel, undefined);
});
