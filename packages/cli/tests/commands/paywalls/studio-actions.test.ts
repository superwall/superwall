import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { createStudioActions } from "@/commands/paywalls/studio-actions";
import { VERSION } from "@/constants";
import type { Framework, FrameworkProject, FrameworkSurface } from "@/core/paywalls/project/framework";
import { writeApplicationId, writeBinding } from "@/core/paywalls/project/lock";

const dirs: string[] = [];
const servers: http.Server[] = [];
const savedEnv = { ...process.env };

function scaffold(): FrameworkProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-studio-actions-"));
  dirs.push(dir);
  return { root: dir, superwallDir: dir, surfaces: [], diagnostics: [] };
}

const surface: FrameworkSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  dir: "/tmp/x",
  configFile: "/tmp/x/config.ts",
  pages: [],
};

const builds: (string | undefined)[] = [];

const framework: Framework = {
  discoverProject: () => {
    throw new Error("unused");
  },
  buildSnapshot: async (_project, _surface, options) => {
    builds.push(options?.assetBaseUrl);
    return {
      snapshotId: "abc",
      html: "<html></html>",
      bytes: 13,
      htmlFile: "x",
      assets: [],
      assetBytes: 0,
    };
  },
  startPreviewServer: async () => ({}),
};

interface FakeApi {
  calls: string[];
  bodies: Record<string, string>;
  bare: string;
}

async function startApi(options: { rejectSource?: boolean } = {}): Promise<FakeApi> {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-studio-bare-"));
  dirs.push(bare);
  execFileSync("git", ["init", "--bare", "--initial-branch", "main", bare]);
  const api: FakeApi = { calls: [], bodies: {}, bare };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      const url = req.url ?? "";
      api.calls.push(`${req.method} ${url}`);
      api.bodies[url] = raw;
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (url.endsWith("/source-access")) {
        send(200, {
          repo: "org1-app42",
          remote: `file://${bare}`,
          branch: "main",
          token: "art_v1_deadbeefcafebabe?expires=1790000000",
          token_id: "tok_1",
        });
      } else if (url.endsWith("/source-commit")) {
        if (options.rejectSource) send(422, { error: "source rejected" });
        else send(200, { commit_sha: "linked" });
      } else if (url.endsWith("/assets")) {
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        const entries = Reflect.get(Object(parsed), "assets");
        send(200, {
          assets: (Array.isArray(entries) ? entries : []).map((entry: unknown) => ({
            sha256: Reflect.get(Object(entry), "sha256"),
            url: `https://user-content.superwalleditor.com/user-content/hl/42/${Reflect.get(Object(entry), "file_name")}`,
          })),
        });
      } else if (req.method === "GET" && url.startsWith("/v2/paywalls?")) {
        send(200, { data: [], has_more: false });
      } else if (req.method === "GET" && /\/v2\/paywalls\/\d+$/.test(url)) {
        send(200, { id: 208540, application_id: 42 });
      } else if (url.endsWith("/source")) {
        if (options.rejectSource) send(422, { error: "source rejected" });
        else
          send(200, {
            object: "paywall.source_push",
            commit_sha: "9f2c1ab77d4e",
            repo: "org1-app2",
            status: "committed",
          });
      } else if (url.endsWith("/versions")) {
        send(200, { version: 7, snapshot_id: "abc", url: "https://r.test/7.html" });
      } else if (url.endsWith("/promote")) {
        send(200, { version: 7, url: "https://r.test/7.html" });
      } else {
        send(404, {});
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  process.env.SUPERWALL_API_KEY = "sk_test_studio";
  process.env.SUPERWALL_API_HOST = `http://127.0.0.1:${port}`;
  return api;
}

function boundProject(): FrameworkProject {
  const project = scaffold();
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", { paywallId: "208540" });
  return project;
}

afterEach(async () => {
  builds.length = 0;
  process.env = { ...savedEnv };
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run without credentials fails with the login guidance, never throws", async () => {
  delete process.env.SUPERWALL_API_KEY;
  process.env.HOME = scaffold().root;

  const actions = createStudioActions(framework, scaffold());
  const result = await actions.run("push", surface);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /superwall login|SUPERWALL_API_KEY/);
  }
});

test("run surfaces an unreachable API as a message", async () => {
  process.env.SUPERWALL_API_KEY = "sk_test_dead";
  process.env.SUPERWALL_API_HOST = "http://127.0.0.1:1";

  const project = scaffold();
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", { paywallId: "208540" });
  const actions = createStudioActions(framework, project);
  const result = await actions.run("push", surface);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Couldn't reach the Superwall API/);
  }
});

test("publish pushes the source between the version and the promote", async () => {
  const api = await startApi();
  const project = boundProject();

  const steps: string[] = [];
  const result = await createStudioActions(framework, project).run(
    "publish",
    surface,
    (step, state) => steps.push(`${step}:${state}`),
  );

  assert.deepEqual(result, { ok: true, version: 7, live: true });
  assert.deepEqual(steps, [
    "link:start",
    "link:done",
    "build:start",
    "build:done",
    "assets:start",
    "assets:done",
    "push:start",
    "push:done",
    "source:start",
    "source:done",
    "promote:start",
    "promote:done",
  ]);
  assert.deepEqual(api.calls, [
    "GET /v2/paywalls/208540",
    "POST /v2/paywalls/208540/versions",
    "POST /v2/paywalls/208540/source-access",
    "POST /v2/paywalls/208540/versions/7/source-commit",
    "POST /v2/paywalls/208540/promote",
  ]);
});

test("the build is told where this app's assets are hosted, using the resolved app id", async () => {
  await startApi();
  const project = boundProject();

  await createStudioActions(framework, project).run("push", surface);

  assert.deepEqual(builds, [
    "https://user-content.superwalleditor.com/user-content/hl/42",
  ]);
});

test("hosted assets are synced before the push and travel with the version", async () => {
  const api = await startApi();
  const project = boundProject();
  const asset = {
    fileName: "abc.png",
    sha256: "abc",
    bytes: 3,
    mime: "image/png",
    path: path.join(project.superwallDir, "hero.png"),
  };
  fs.writeFileSync(asset.path, Buffer.from([1, 2, 3]));

  const withAssets: Framework = {
    ...framework,
    buildSnapshot: async () => ({
      snapshotId: "abc",
      html: "<html></html>",
      bytes: 13,
      htmlFile: "x",
      assets: [asset],
      assetBytes: 3,
    }),
  };

  const steps: string[] = [];
  const result = await createStudioActions(withAssets, project).run(
    "push",
    surface,
    (step, state) => steps.push(`${step}:${state}`),
  );

  assert.equal(result.ok, true);
  assert.ok(steps.includes("assets:done"));
  assert.ok(api.calls.includes("POST /v2/paywalls/208540/assets"));
  assert.ok(
    api.calls.indexOf("POST /v2/paywalls/208540/assets") <
      api.calls.indexOf("POST /v2/paywalls/208540/versions"),
  );

  const manifest: unknown = JSON.parse(api.bodies["/v2/paywalls/208540/assets"] ?? "{}");
  assert.deepEqual(Reflect.get(Object(manifest), "assets"), [
    { sha256: "abc", bytes: 3, mime: "image/png", file_name: "abc.png" },
  ]);
});

test("the source push commits the tree with the platform's message", async () => {
  const api = await startApi();
  const project = boundProject();

  await createStudioActions(framework, project).run("push", surface);

  const shown = execFileSync("git", ["--git-dir", api.bare, "show", "main"], {
    encoding: "utf8",
  });
  assert.match(shown, /publish paywall\/plus-upgrade v7/);
  assert.match(shown, /Superwall-Paywall: 208540/);
  assert.match(shown, /Superwall-Portable: true/);
  assert.match(shown, new RegExp(`Superwall-Cli: ${VERSION.replace(/\./g, "\\.")}`));

  const tracked = execFileSync(
    "git",
    ["--git-dir", api.bare, "ls-tree", "-r", "--name-only", "main"],
    { encoding: "utf8" },
  );
  assert.match(tracked, /superwall\.lock/);
  assert.doesNotMatch(tracked, /\.superwall-manifest\.json/);
});

test("a rejected source push fails the action and production is never repointed", async () => {
  const api = await startApi({ rejectSource: true });
  const project = boundProject();

  const result = await createStudioActions(framework, project).run("publish", surface);

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /HTTP 422/);
  assert.ok(!api.calls.some((call) => call.includes("/promote")));
  assert.ok(api.calls.some((call) => call.includes("/source-commit")));
});

test("status is empty for an unbound surface and never throws", async () => {
  const actions = createStudioActions(framework, scaffold());
  assert.deepEqual(await actions.status(surface), {});
});

test("status swallows API failures", async () => {
  process.env.SUPERWALL_API_KEY = "sk_test_dead";
  process.env.SUPERWALL_API_HOST = "http://127.0.0.1:1";

  const project = scaffold();
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", { paywallId: "208540" });
  const actions = createStudioActions(framework, project);
  assert.deepEqual(await actions.status(surface), {});
});

test("promote from the studio links without creating and never builds", async () => {
  const api = await startApi();
  const project = boundProject();

  const steps: string[] = [];
  const result = await createStudioActions(framework, project).run("promote", surface, (step, state) =>
    steps.push(`${step}:${state}`),
  );

  assert.deepEqual(result, { ok: true, version: 7, live: true });
  assert.deepEqual(steps, ["link:start", "link:done", "promote:start", "promote:done"]);
  assert.deepEqual(builds, []);
  assert.ok(!api.calls.includes("POST /v2/paywalls/208540/versions"));
});

test("promoting a surface that was never pushed explains itself instead of creating one", async () => {
  await startApi();
  const project = scaffold();
  writeApplicationId(project.superwallDir, "42");

  const result = await createStudioActions(framework, project).run("promote", surface);

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /never been pushed/);
});

test("status reports the live url and active flag straight from the paywall", async () => {
  await startApi();
  const project = boundProject();

  assert.deepEqual(await createStudioActions(framework, project).status(surface), {
    paywallId: "208540",
    liveUrl: undefined,
    active: false,
    updatedAt: undefined,
  });
});
