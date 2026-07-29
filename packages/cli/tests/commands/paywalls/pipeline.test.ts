import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { Arguments } from "yargs";
import {
  needsWork,
  pendingPromoteWarning,
  runPushPipeline,
  selectSurfaces,
} from "@/commands/paywalls/pipeline";
import type { CommandContext } from "@/command";
import { SuperwallApi } from "@/core/api/client";
import type {
  Framework,
  FrameworkProject,
  FrameworkSurface,
} from "@/core/paywalls/project/framework";
import { readLock, writeApplicationId, writeBinding } from "@/core/paywalls/project/lock";
import { selectRenderer, ui } from "@/ui";

selectRenderer({ mode: "json" });

const dirs: string[] = [];
const servers: http.Server[] = [];

const surfaceOf = (id: string, kind: "paywall" | "funnel" = "paywall"): FrameworkSurface => ({
  kind,
  id,
  dir: `/tmp/${id}`,
  configFile: `/tmp/${id}/config.ts`,
  pages: [],
});

function scaffold(ids: string[] = ["plus-upgrade"]): FrameworkProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-pipeline-"));
  dirs.push(dir);
  writeApplicationId(dir, "42");
  for (const id of ids) writeBinding(dir, "paywall", id, { paywallId: `208${ids.indexOf(id)}` });
  return {
    root: dir,
    superwallDir: dir,
    marker: "package.json",
    packageName: "acme-paywalls",
    surfaces: ids.map((id) => surfaceOf(id)),
    diagnostics: [],
  };
}

interface Route {
  status?: number;
  body?: unknown;
}

interface Fake {
  calls: string[];
  bodies: Record<string, string>;
  routes: Record<string, Route>;
  api: SuperwallApi;
  bare: string;
}

async function fakeApi(routes: Record<string, Route> = {}): Promise<Fake> {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-pipeline-bare-"));
  dirs.push(bare);
  execFileSync("git", ["init", "--bare", "--initial-branch", "main", bare]);
  const fake: Fake = { calls: [], bodies: {}, routes, api: SuperwallApi.of({} as never), bare };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      const url = req.url ?? "";
      const kind = url.endsWith("/assets")
        ? "assets"
        : url.endsWith("/promote")
          ? "promote"
          : url.endsWith("/source-access")
            ? "access"
            : url.endsWith("/source-commit")
              ? "link"
              : url.endsWith("/versions")
                ? "versions"
                : /^\/v2\/paywalls\/[^/]+$/.test(url) && req.method === "GET"
                  ? "live"
                  : "other";
      fake.calls.push(kind);
      fake.bodies[kind] = raw;

      const route = fake.routes[kind] ?? {};
      const fallback: Record<string, unknown> = {
        assets: { assets: [] },
        versions: { version: 7, snapshot_id: "abc", url: "u" },
        access: {
          repo: "org1-app42",
          remote: `file://${bare}`,
          branch: "main",
          token: "art_v1_deadbeefcafebabe?expires=1790000000",
          token_id: "tok_1",
        },
        link: { commit_sha: "linked" },
        promote: { version: 7, url: "u" },
        live: { id: "2080" },
        other: {},
      };
      res.writeHead(route.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(route.body ?? fallback[kind]));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  process.env.SUPERWALL_API_KEY = "sk_test_pipeline";
  process.env.SUPERWALL_API_HOST = `http://127.0.0.1:${port}`;
  fake.api = SuperwallApi.of({
    authMethod: "api_key",
    apiKey: "sk_test_pipeline",
    host: `http://127.0.0.1:${port}`,
    createdAt: new Date().toISOString(),
  });
  return fake;
}

const built = (over: Record<string, unknown> = {}) => ({
  snapshotId: "abcdef0123456789",
  html: "<html></html>",
  bytes: 13,
  htmlFile: "x",
  assets: [],
  assetBytes: 0,
  ...over,
});

function frameworkFor(
  project: FrameworkProject,
  over: Partial<Framework> = {},
  steps: string[] = [],
): Framework {
  return {
    discoverProject: () => project,
    buildSnapshot: async () => {
      steps.push("build");
      return built();
    },
    startPreviewServer: async () => ({}),
    ...over,
  };
}

function contextFor(api: SuperwallApi, argv: Partial<Arguments> = {}): CommandContext<"required"> {
  return {
    argv: { _: [], $0: "superwall", ...argv } as Arguments,
    api,
    outputMode: "json",
    interactive: false,
    installDir: process.cwd(),
    json: false,
    dryRun: false,
  } as CommandContext<"required">;
}

afterEach(async () => {
  delete process.env.SUPERWALL_API_KEY;
  delete process.env.SUPERWALL_API_HOST;
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("push runs link, build, assets, push and source, and stops before promote", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, ["live", "versions", "access", "link"]);
});

test("publish promotes only after the source push lands", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, ["live", "versions", "access", "link", "promote"]);
});

test("a paywall with assets syncs them before the version push", async () => {
  const project = scaffold();
  const asset = path.join(project.superwallDir, "hero.png");
  fs.writeFileSync(asset, Buffer.alloc(64, 1));
  const fake = await fakeApi({
    assets: {
      body: {
        assets: [
          {
            sha256: "aaa",
            url: "https://user-content.superwalleditor.com/user-content/hl/42/aaa.png",
          },
        ],
      },
    },
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () =>
          built({
            assets: [
              { fileName: "aaa.png", sha256: "aaa", bytes: 64, mime: "image/png", path: asset },
            ],
            assetBytes: 64,
          }),
      }),
  });

  assert.deepEqual(fake.calls, ["live", "assets", "versions", "access", "link"]);
  const version: unknown = JSON.parse(fake.bodies.versions ?? "{}");
  assert.deepEqual(Reflect.get(Object(version), "assets"), [
    {
      url: "https://user-content.superwalleditor.com/user-content/hl/42/aaa.png",
      mime_type: "image/png",
    },
  ]);
});

test("a build failure stops the surface before anything reaches Superwall", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: true,
      load: async () =>
        frameworkFor(project, {
          buildSnapshot: async () => {
            throw new Error("vite exploded");
          },
        }),
    }),
    /vite exploded/,
  );
  assert.deepEqual(fake.calls, []);
});

test("a framework too old to report assets fails before the version push", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () =>
        frameworkFor(project, {
          buildSnapshot: async () => {
            const stale = built();
            delete (stale as Record<string, unknown>).assets;
            return stale;
          },
        }),
    }),
    /update the project's superwall dependency/,
  );
  assert.deepEqual(fake.calls, []);
});

test("a link failure never builds — an unbindable surface has nothing to push to", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-pipeline-"));
  dirs.push(dir);
  const project: FrameworkProject = {
    root: dir,
    superwallDir: dir,
    surfaces: [surfaceOf("plus-upgrade")],
    diagnostics: [],
  };
  const fake = await fakeApi({ other: { status: 500, body: { error: "nope" } } });
  const steps: string[] = [];

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () => frameworkFor(project, {}, steps),
    }),
  );
  assert.deepEqual(steps, []);
});

for (const [label, status] of [
  ["4xx", 422],
  ["5xx", 503],
] as const) {
  test(`an assets ${label} fails the surface and never pushes a version`, async () => {
    const project = scaffold();
    const asset = path.join(project.superwallDir, "hero.png");
    fs.writeFileSync(asset, Buffer.alloc(64, 1));
    const fake = await fakeApi({ assets: { status, body: { error: "no" } } });

    await assert.rejects(
      runPushPipeline(contextFor(fake.api), {
        promote: true,
        load: async () =>
          frameworkFor(project, {
            buildSnapshot: async () =>
              built({
                assets: [
                  { fileName: "aaa.png", sha256: "aaa", bytes: 64, mime: "image/png", path: asset },
                ],
                assetBytes: 64,
              }),
          }),
      }),
      new RegExp(String(status)),
    );
    assert.deepEqual(fake.calls, ["live", "assets"]);
  });
}

test("a version push failure never reaches source or promote", async () => {
  const project = scaffold();
  const fake = await fakeApi({ versions: { status: 500, body: { error: "boom" } } });

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: true,
      load: async () => frameworkFor(project),
    }),
    /500/,
  );
  assert.deepEqual(fake.calls, ["live", "versions"]);
});

test("a failed live-version lookup never fails the push — the version is what matters", async () => {
  const project = scaffold();
  const fake = await fakeApi({ live: { status: 500, body: { message: "down" } } });

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, ["live", "versions", "access", "link", "promote"]);
});

test("a source failure blocks promote — production keeps the old version", async () => {
  const project = scaffold();
  const fake = await fakeApi({ link: { status: 500, body: { error: "rejected" } } });

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: true,
      load: async () => frameworkFor(project),
    }),
    /500/,
  );
  assert.deepEqual(fake.calls, ["live", "versions", "access", "link"]);
  assert.ok(!fake.calls.includes("promote"));
});

test("a source repo that cannot be reached fails the surface before promote", async () => {
  const project = scaffold();
  const fake = await fakeApi({ access: { status: 503, body: { error: "no repos" } } });

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: true,
      load: async () => frameworkFor(project),
    }),
    /503/,
  );
  assert.deepEqual(fake.calls, ["live", "versions", "access"]);
});

test("a promote failure surfaces after the version is already safely pushed", async () => {
  const project = scaffold();
  const fake = await fakeApi({ promote: { status: 500, body: { error: "later" } } });

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: true,
      load: async () => frameworkFor(project),
    }),
    /500/,
  );
  assert.deepEqual(fake.calls, ["live", "versions", "access", "link", "promote"]);
});

test("a tree far past the old JSON cap publishes fine over git", async () => {
  const project = scaffold();
  fs.writeFileSync(path.join(project.superwallDir, "stray.bin"), Buffer.alloc(9 * 1024 * 1024, 4));
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, ["live", "versions", "access", "link", "promote"]);
  const tracked = execFileSync(
    "git",
    ["--git-dir", fake.bare, "ls-tree", "-r", "--name-only", "main"],
    { encoding: "utf8" },
  );
  assert.match(tracked, /stray\.bin/);
});

test("every surface builds up front, but the first failure stops shipping", async () => {
  const project = scaffold(["alpha", "beta"]);
  const fake = await fakeApi({ versions: { status: 500, body: {} } });
  const steps: string[] = [];

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () => frameworkFor(project, {}, steps),
    }),
  );
  assert.deepEqual(steps, ["build", "build"]);
  assert.deepEqual(
    fake.calls.filter((call) => call !== "live"),
    ["versions"],
  );
});

test("--only narrows the run to one surface", async () => {
  const project = scaffold(["alpha", "beta"]);
  const fake = await fakeApi();
  const steps: string[] = [];

  await runPushPipeline(contextFor(fake.api, { id: ["beta"] }), {
    promote: false,
    load: async () => frameworkFor(project, {}, steps),
  });

  assert.deepEqual(steps, ["build"]);
  assert.deepEqual(fake.calls, ["live", "versions", "access", "link"]);
});

test("selectSurfaces explains an unknown name, and an empty project", () => {
  const project: FrameworkProject = {
    root: "/tmp",
    superwallDir: "/tmp",
    surfaces: [surfaceOf("alpha"), surfaceOf("onboarding", "funnel")],
    diagnostics: [],
  };

  assert.deepEqual(
    selectSurfaces(project, "onboarding").map((surface) => surface.id),
    ["onboarding"],
  );
  assert.deepEqual(selectSurfaces(project, undefined).length, 2);
  assert.throws(() => selectSurfaces(project, "nope"), /this project has: alpha, onboarding/);
  assert.throws(
    () => selectSurfaces({ ...project, surfaces: [] }, undefined),
    /No paywalls or funnels found/,
  );
  assert.throws(() => selectSurfaces({ ...project, surfaces: [] }, "nope"), /expected superwall/);
});

test("the source bundle is collected once and reused for every surface", async () => {
  const project = scaffold(["alpha", "beta"]);
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, [
    "live",
    "live",
    "versions",
    "access",
    "link",
    "versions",
    "access",
    "link",
  ]);
});

test("an interactive run offers the app picker; a lock hit still never needs it", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline({ ...contextFor(fake.api), interactive: true }, {
    promote: false,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, ["live", "versions", "access", "link"]);
});

test("rich output renders through the spinner on success and on failure", async () => {
  const project = scaffold();
  const ok = await fakeApi();

  await runPushPipeline({ ...contextFor(ok.api), outputMode: "rich" }, {
    promote: false,
    load: async () => frameworkFor(project),
  });
  assert.deepEqual(ok.calls, ["live", "versions", "access", "link"]);

  const failing = scaffold();
  const bad = await fakeApi({ versions: { status: 500, body: {} } });
  await assert.rejects(
    runPushPipeline({ ...contextFor(bad.api), outputMode: "rich" }, {
      promote: false,
      load: async () => frameworkFor(failing),
    }),
    /500/,
  );
});

test("a megabyte-scale asset is reported in MB, and one asset reads as singular", async () => {
  const project = scaffold();
  const asset = path.join(project.superwallDir, "big.png");
  fs.writeFileSync(asset, Buffer.alloc(2 * 1024 * 1024, 1));
  const fake = await fakeApi({
    assets: {
      body: {
        assets: [
          {
            sha256: "big",
            url: "https://user-content.superwalleditor.com/user-content/hl/42/big.png",
            upload_url: "http://127.0.0.1:1/nope",
          },
        ],
      },
    },
  });

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () =>
        frameworkFor(project, {
          buildSnapshot: async () =>
            built({
              assets: [
                {
                  fileName: "big.png",
                  sha256: "big",
                  bytes: 2 * 1024 * 1024,
                  mime: "image/png",
                  path: asset,
                },
              ],
              assetBytes: 2 * 1024 * 1024,
            }),
        }),
    }),
    /Couldn't upload big\.png/,
  );
  assert.deepEqual(fake.calls, ["live", "assets"]);
});

test("-m threads the publish note into the source push verbatim", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  const note = "Ship the Q3 pricing test\n\nRolls the toggle default to plus.";

  await runPushPipeline(contextFor(fake.api, { message: note }), {
    promote: true,
    load: async () => frameworkFor(project),
  });

  const shown = execFileSync("git", ["--git-dir", fake.bare, "show", "main"], {
    encoding: "utf8",
  });
  assert.match(shown, /Ship the Q3 pricing test/);
  assert.match(shown, /Rolls the toggle default to plus\./);
});

test("without -m the payload carries no note field at all", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  const shown = execFileSync("git", ["--git-dir", fake.bare, "show", "main"], {
    encoding: "utf8",
  });
  assert.match(shown, /publish paywall\/plus-upgrade v7/);
});

test("a non-string --message is ignored rather than sent as junk", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api, { message: 42 }), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  const shown = execFileSync("git", ["--git-dir", fake.bare, "show", "main"], {
    encoding: "utf8",
  });
  assert.match(shown, /publish paywall\/plus-upgrade v7/);
});

test("an empty -m adds no body to the commit", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api, { message: "" }), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  const shown = execFileSync("git", ["--git-dir", fake.bare, "show", "main"], {
    encoding: "utf8",
  });
  assert.match(shown, /publish paywall\/plus-upgrade v7/);
});

test("an over-long note fails the run upfront, before anything is pushed", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  const steps: string[] = [];

  await assert.rejects(
    runPushPipeline(contextFor(fake.api, { message: "x".repeat(2001) }), {
      promote: true,
      load: async () => frameworkFor(project, {}, steps),
    }),
    /Publish note is 2001 characters \(limit 2000\)\./,
  );
  assert.deepEqual(steps, []);
  assert.deepEqual(fake.calls, []);
});

test("a note exactly at the limit is accepted", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  const note = "x".repeat(2000);

  await runPushPipeline(contextFor(fake.api, { message: note }), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  const shown = execFileSync("git", ["--git-dir", fake.bare, "show", "main"], {
    encoding: "utf8",
  });
  assert.ok(shown.includes(note));
});

test("an unresolved rename stops the push before anything is created or uploaded", async () => {
  const project = scaffold(["plus-upgrade"]);
  const renamed = surfaceOf("pro-upgrade");
  project.surfaces = [renamed];
  const fake = await fakeApi();

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () => frameworkFor(project),
    }),
    (error: Error) => /Cannot tell whether these are new or renamed/.test(error.message),
  );

  assert.deepEqual(fake.calls, [], "no version, no source push, and above all no create");
  assert.deepEqual(readLock(project.superwallDir).paywalls, {
    "plus-upgrade": { paywallId: "2080" },
  });
});

test("a declared rename carries the live paywall id through the whole push", async () => {
  const project = scaffold(["plus-upgrade"]);
  const renamed = surfaceOf("pro-upgrade");
  project.surfaces = [renamed];
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api, { rename: ["plus-upgrade=pro-upgrade"] }), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(readLock(project.superwallDir).paywalls, {
    "pro-upgrade": { paywallId: "2080", snapshot: "abcdef0123456789" },
  });
  assert.ok(fake.calls.includes("versions"), "the renamed surface still pushes a version");
});

test("a surface whose snapshot already matches production is skipped entirely", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: { body: { id: "2080", version: 7, paywall_url: `https://r/x/headless/2080/${"a".repeat(64)}.html` } },
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ snapshotId: "a".repeat(64) }),
      }),
  });

  assert.deepEqual(fake.calls, ["live"]);
});

test("a changed snapshot still ships when production is on an older one", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: { body: { id: "2080", version: 7, paywall_url: `https://r/x/headless/2080/${"b".repeat(64)}.html` } },
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ snapshotId: "a".repeat(64) }),
      }),
  });

  assert.deepEqual(fake.calls, ["live", "versions", "access", "link"]);
});

test("--id selects several surfaces, and an unknown id names what the project has", async () => {
  const project = scaffold(["alpha", "beta", "gamma"]);
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api, { id: ["alpha", "gamma"] }), {
    promote: false,
    load: async () => frameworkFor(project),
  });
  assert.equal(fake.calls.filter((call) => call === "versions").length, 2);

  await assert.rejects(
    runPushPipeline(contextFor(fake.api, { id: ["nope"] }), {
      promote: false,
      load: async () => frameworkFor(project),
    }),
    /No paywall or funnel named "nope".*alpha, beta, gamma/s,
  );
});

test("--id accepts a comma-separated list", async () => {
  const project = scaffold(["alpha", "beta", "gamma"]);
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api, { id: ["alpha,beta"] }), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  assert.equal(fake.calls.filter((call) => call === "versions").length, 2);
});

test("pushing twice with no edits skips the second run — the version already exists", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: { body: { id: "2080", version: 11, paywall_url: `https://r/x/headless/2080/${"c".repeat(64)}.html` } },
  });
  const load = async () => frameworkFor(project);

  await runPushPipeline(contextFor(fake.api), { promote: false, load });
  assert.deepEqual(fake.calls, ["live", "versions", "access", "link"]);

  fake.calls.length = 0;
  await runPushPipeline(contextFor(fake.api), { promote: false, load });
  assert.deepEqual(fake.calls, ["live"], "nothing to push: the built snapshot is already a version");
});

test("needsWork compares against the last pushed snapshot, never the live one", () => {
  const built = "a".repeat(64);
  const other = "b".repeat(64);

  assert.equal(needsWork(built, undefined, undefined), true, "never pushed");
  assert.equal(needsWork(built, other, other), true, "content differs from what was pushed");
  assert.equal(needsWork(built, built, other), false, "already pushed, even though live is older");
  assert.equal(needsWork(built, undefined, built), false, "live implies it was pushed");
  assert.equal(needsWork(built, built, built), false, "pushed and live");
});

test("publish refuses to re-push an identical version and points at promote instead", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: { body: { id: "2080", version: 11, paywall_url: `https://r/x/headless/2080/${"c".repeat(64)}.html` } },
  });
  const load = async () => frameworkFor(project);

  await runPushPipeline(contextFor(fake.api), { promote: false, load });
  fake.calls.length = 0;

  await runPushPipeline(contextFor(fake.api), { promote: true, load });

  assert.deepEqual(fake.calls, ["live"], "no second version push, and no promote of an old push");
});

test("publish still pushes and promotes when the code actually changed", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  let snapshot = "a".repeat(64);

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => frameworkFor(project, { buildSnapshot: async () => built({ snapshotId: snapshot }) }),
  });
  fake.calls.length = 0;

  snapshot = "d".repeat(64);
  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () => frameworkFor(project, { buildSnapshot: async () => built({ snapshotId: snapshot }) }),
  });

  assert.deepEqual(fake.calls, ["live", "versions", "access", "link", "promote"]);
});

test("push stays quiet about a pending promote — that hint belongs to publish", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: { body: { id: "2080", version: 11, paywall_url: `https://r/x/headless/2080/${"c".repeat(64)}.html` } },
  });
  const load = async () => frameworkFor(project);
  const warnings: string[] = [];
  const warn = ui.warn;
  ui.warn = (message: string) => warnings.push(message);

  try {
    await runPushPipeline(contextFor(fake.api), { promote: false, load });
    warnings.length = 0;
    await runPushPipeline(contextFor(fake.api), { promote: false, load });
    assert.deepEqual(warnings, [], "push says nothing about promoting");

    await runPushPipeline(contextFor(fake.api), { promote: true, load });
    assert.equal(warnings.length, 1, "publish does");
    assert.match(warnings[0] ?? "", /is pushed but not live/);
  } finally {
    ui.warn = warn;
  }
});

test("no promote hint when the built snapshot is what production already serves", async () => {
  const project = scaffold();
  const snapshot = "e".repeat(64);
  const fake = await fakeApi({
    live: { body: { id: "2080", version: 7, paywall_url: `https://r/x/headless/2080/${snapshot}.html` } },
  });
  const warnings: string[] = [];
  const warn = ui.warn;
  ui.warn = (message: string) => warnings.push(message);

  try {
    await runPushPipeline(contextFor(fake.api), {
      promote: true,
      load: async () =>
        frameworkFor(project, { buildSnapshot: async () => built({ snapshotId: snapshot }) }),
    });
    assert.deepEqual(fake.calls, ["live"], "already live: nothing to push, nothing to promote");
    assert.deepEqual(warnings, [], "and nothing to warn about");
  } finally {
    ui.warn = warn;
  }
});

test("several pending paywalls are named in one hint, with a single promote command", async () => {
  const project = scaffold(["alpha", "beta", "gamma"]);
  const fake = await fakeApi({
    live: { body: { id: "2080", version: 11, paywall_url: `https://r/x/headless/2080/${"c".repeat(64)}.html` } },
  });
  const load = async () => frameworkFor(project);
  const warnings: string[] = [];
  const warn = ui.warn;
  ui.warn = (message: string) => warnings.push(message);

  try {
    await runPushPipeline(contextFor(fake.api), { promote: false, load });
    warnings.length = 0;
    await runPushPipeline(contextFor(fake.api), { promote: true, load });

    assert.equal(warnings.length, 1, "one hint, not one per paywall");
    assert.equal(
      warnings[0],
      [
        "These 3 paywalls are pushed but not live:",
        "  alpha",
        "  beta",
        "  gamma",
        "",
        "  superwall promote --id alpha,beta,gamma",
      ].join("\n"),
    );
  } finally {
    ui.warn = warn;
  }
});

test("pendingPromoteWarning: silent when empty, a sentence for one, a list for many", () => {
  assert.equal(pendingPromoteWarning([]), undefined);

  assert.equal(
    pendingPromoteWarning(["plus-upgrade"]),
    "plus-upgrade is pushed but not live — run `superwall promote --id plus-upgrade` to publish it.",
  );

  const many = pendingPromoteWarning(["a", "b"]);
  assert.equal(many, ["These 2 paywalls are pushed but not live:", "  a", "  b", "", "  superwall promote --id a,b"].join("\n"));

  const lots = pendingPromoteWarning(Array.from({ length: 13 }, (_, i) => `p${i}`));
  assert.match(lots ?? "", /…and 3 more/, "the list is capped");
  assert.match(lots ?? "", /--id p0,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12/, "the command is not");
});
