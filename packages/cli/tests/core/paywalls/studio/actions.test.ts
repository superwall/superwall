import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { createStudioActions } from "@/core/paywalls/studio/actions";
import { VERSION } from "@/environment";
import type { Framework, FrameworkProject, FrameworkSurface } from "@/core/paywalls/project/framework";
import { readLock, writeApp, writeBinding } from "@/core/paywalls/project/lock";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

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
  routes: [],
};

const builds: (string | undefined)[] = [];

const framework: Framework = {
  discoverProject: () => {
    throw new Error("unused");
  },
  buildSnapshot: async (_project, _surface, options) => {
    builds.push(options?.assetBaseUrl);
    return {
      name: "Pro",
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
  gate?: (url: string) => { status: number; body: unknown } | undefined;
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
      const gated = api.gate?.(url);
      if (gated) {
        send(gated.status, gated.body);
      } else if (url.endsWith("/source-access")) {
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
      } else if (req.method === "GET" && url.startsWith("/v2/projects")) {
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
      } else if (req.method === "GET" && url.endsWith("/versions")) {
        send(200, {
          object: "list",
          data: [
            {
              version: 7,
              url: "https://r.test/7.html",
              live: true,
              created_at: "2026-09-01T00:00:00.000Z",
            },
          ],
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
  writeApp(project.superwallDir, "ios", "42");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
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
  writeApp(project.superwallDir, "ios", "42");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
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
    "GET /v2/projects?limit=100",
    "GET /v2/paywalls?application_id=42&limit=1",
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
      name: "Pro",
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

test("status reports an unreachable API instead of throwing", async () => {
  process.env.SUPERWALL_API_KEY = "sk_test_dead";
  process.env.SUPERWALL_API_HOST = "http://127.0.0.1:1";

  const project = scaffold();
  writeApp(project.superwallDir, "ios", "42");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  const actions = createStudioActions(framework, project);
  const status = await actions.status(surface);
  assert.deepEqual(Object.keys(status), ["unreachable"]);
  assert.match(status.unreachable ?? "", /Couldn't reach the Superwall API at http:\/\/127\.0\.0\.1:1/);
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

test("promote carries the version the studio picked, and only that", async () => {
  const api = await startApi();
  const project = boundProject();

  const result = await createStudioActions(framework, project).run(
    "promote",
    surface,
    undefined,
    { version: 5 },
  );

  assert.deepEqual(result, { ok: true, version: 7, live: true });
  assert.deepEqual(JSON.parse(api.bodies["/v2/paywalls/208540/promote"] ?? "{}"), { version: 5 });

  await createStudioActions(framework, project).run("promote", surface);
  assert.deepEqual(JSON.parse(api.bodies["/v2/paywalls/208540/promote"] ?? "{}"), {});
});

test("a picked version refuses a surface on several platforms, naming the CLI flag", async () => {
  const api = await startApi();
  const project = boundProject();
  writeApp(project.superwallDir, "android", "43");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "android", { paywallId: "208541" });
  const declaring: Framework = {
    ...framework,
    studioProject: async () => ({
      surfaces: [{ kind: "paywall", id: "plus-upgrade", products: {}, platforms: ["ios", "android"] }],
    }),
  };

  const result = await createStudioActions(declaring, project).run(
    "promote",
    surface,
    undefined,
    { version: 5 },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /v5 targets one paywall/);
    assert.match(result.error, /--platform <platform> --version 5/);
  }
  assert.ok(!api.calls.some((call) => call.includes("/promote")));
});

test("promoting a surface that was never pushed explains itself instead of creating one", async () => {
  await startApi();
  const project = scaffold();
  writeApp(project.superwallDir, "ios", "42");

  const result = await createStudioActions(framework, project).run("promote", surface);

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /never been pushed/);
});

test("status reports every pushed version and the active flag straight from the paywall", async () => {
  await startApi();
  const project = boundProject();

  assert.deepEqual(await createStudioActions(framework, project).status(surface), {
    paywallId: "208540",
    versions: [
      {
        version: 7,
        url: "https://r.test/7.html",
        live: true,
        pushedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    active: false,
    updatedAt: undefined,
    identifier: undefined,
  });
});

test("a surface declared for two platforms is built, pushed, and promoted once per app", async () => {
  const api = await startApi();
  const project = boundProject();
  writeApp(project.superwallDir, "android", "43");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "android", { paywallId: "208541" });
  const declaring: Framework = {
    ...framework,
    studioProject: async () => ({
      surfaces: [{ kind: "paywall", id: "plus-upgrade", products: {}, platforms: ["ios", "android"] }],
    }),
  };

  const steps: string[] = [];
  const result = await createStudioActions(declaring, project).run("publish", surface, (step, state) =>
    steps.push(`${step}:${state}`),
  );

  assert.deepEqual(result, { ok: true, version: 7, live: true });
  assert.deepEqual(builds, [
    "https://user-content.superwalleditor.com/user-content/hl/42",
    "https://user-content.superwalleditor.com/user-content/hl/43",
  ]);
  assert.equal(steps.filter((step) => step === "push:done").length, 2);
  assert.ok(api.calls.includes("POST /v2/paywalls/208540/promote"));
  assert.ok(api.calls.includes("POST /v2/paywalls/208541/promote"));
  assert.deepEqual(readLock(project.superwallDir).paywalls["plus-upgrade"], {
    ios: { paywallId: "208540" },
    android: { paywallId: "208541" },
  });
});

test("a surface that names no platform while the project has several fails before building", async () => {
  await startApi();
  const project = boundProject();
  writeApp(project.superwallDir, "android", "43");

  const result = await createStudioActions(framework, project).run("push", surface);

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /doesn't say which platforms it's for/);
  assert.deepEqual(builds, []);
});

test("status keeps the live version and says so when the API cannot list versions", async () => {
  const api = await startApi();
  api.gate = (url) =>
    url.endsWith("/versions")
      ? { status: 404, body: { error: "not found" } }
      : /\/v2\/paywalls\/\d+$/.test(url)
        ? {
            status: 200,
            body: {
              id: 208540,
              application_id: 42,
              version: 3,
              paywall_url: "https://r.test/3.html",
              status: "active",
            },
          }
        : undefined;
  const project = boundProject();

  const status = await createStudioActions(framework, project).status(surface);
  assert.deepEqual(status.versions, [{ version: 3, url: "https://r.test/3.html", live: true }]);
  assert.equal(status.active, true);
  assert.match(status.unreachable ?? "", /404/);
});

test("status reads the first app's binding", async () => {
  await startApi();
  const project = boundProject();
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "android", { paywallId: "208541" });

  const status = await createStudioActions(framework, project).status(surface);
  assert.equal(status.paywallId, "208540");
});

test("samples are fetched for the project's first app, and a missing catalogue is reported, not invented", async () => {
  await startApi();
  const project = boundProject();

  const samples = await createStudioActions(framework, project).samples?.();

  assert.deepEqual(samples?.live, { device: false, user: false });
  assert.equal(samples?.products, undefined);
  assert.equal(samples?.unreachable, undefined, "a 404 on optional sample endpoints is not an outage");
});

test("samples explain an unbound project instead of throwing", async () => {
  await startApi();
  const project = scaffold();

  const samples = await createStudioActions(framework, project).samples?.();

  assert.match(samples?.unreachable ?? "", /has no apps yet/);
});

test("appScheme asks the dashboard for the ios app's scheme when the project binds one", async () => {
  await startApi();
  const project = boundProject();
  writeApp(project.superwallDir, "web", "43");

  const scheme = await createStudioActions(framework, project).appScheme?.();

  assert.equal(typeof scheme, "object");
  assert.equal(scheme?.blocksLocalNetworking, undefined);
});

test("a two-platform studio push sends each app its own product id and store", async () => {
  const api = await startApi();
  const project = boundProject();
  writeApp(project.superwallDir, "android", "43");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "android", { paywallId: "208541" });
  const perPlatform: Framework = {
    ...framework,
    buildSnapshot: async (_project, _surface, options) => ({
      name: "Pro",
      snapshotId: `snap-${options?.platform}`,
      html: "<html></html>",
      bytes: 13,
      htmlFile: "x",
      assets: [],
      assetBytes: 0,
      products: { annual: options?.platform === "android" ? "pro_year_play" : "pro_year" },
    }),
    studioProject: async () => ({
      surfaces: [{ kind: "paywall", id: "plus-upgrade", products: {}, platforms: ["ios", "android"] }],
    }),
  };

  const result = await createStudioActions(perPlatform, project).run("push", surface);

  assert.equal(result.ok, true);
  const ios: unknown = JSON.parse(api.bodies["/v2/paywalls/208540/versions"] ?? "{}");
  const android: unknown = JSON.parse(api.bodies["/v2/paywalls/208541/versions"] ?? "{}");
  assert.deepEqual(Reflect.get(Object(ios), "products"), [
    { store: "app-store", identifier: "pro_year", reference_name: "annual" },
  ]);
  assert.deepEqual(Reflect.get(Object(android), "products"), [
    { store: "play-store", identifier: "pro_year_play", reference_name: "annual" },
  ]);
});

test("a studio push sends the store the project's catalogue records, so a custom product stays custom", async () => {
  const api = await startApi();
  api.gate = (url) => {
    if (url.startsWith("/v2/projects")) {
      return { status: 200, body: { data: [{ id: 9, applications: [{ id: 42 }] }], has_more: false } };
    }
    if (url.startsWith("/v2/products")) {
      return {
        status: 200,
        body: {
          data: [
            { identifier: "pro_year", platform: "ios", store: "app_store" },
            { identifier: "stripe_elite1w", platform: "custom", store: "custom" },
          ],
          has_more: false,
        },
      };
    }
    return undefined;
  };
  const project = boundProject();
  const custom: Framework = {
    ...framework,
    buildSnapshot: async () => ({
      name: "Pro",
      snapshotId: "abc",
      html: "<html></html>",
      bytes: 13,
      htmlFile: "x",
      assets: [],
      assetBytes: 0,
      products: { primary: "pro_year", stripePrimary: "stripe_elite1w" },
    }),
  };

  const result = await createStudioActions(custom, project).run("push", surface);

  assert.equal(result.ok, true);
  const body: unknown = JSON.parse(api.bodies["/v2/paywalls/208540/versions"] ?? "{}");
  assert.deepEqual(Reflect.get(Object(body), "products"), [
    { store: "app-store", identifier: "pro_year", reference_name: "primary" },
    { store: "custom", identifier: "stripe_elite1w", reference_name: "stripePrimary" },
  ]);
});

test("the studio relays the API's private-beta refusal verbatim", async () => {
  const api = await startApi();
  const project = boundProject();
  writeApp(project.superwallDir, "android", "43");
  const gated: Framework = {
    ...framework,
    studioProject: async () => ({
      surfaces: [{ kind: "paywall", id: "plus-upgrade", products: {}, platforms: ["android"] }],
    }),
  };
  api.gate = (url) =>
    url === "/v2/paywalls"
      ? {
          status: 400,
          body: {
            type: "invalid_request_error",
            code: "parameter_invalid",
            message:
              "Superwall for Agents is in private beta and isn't enabled for this app yet. Contact support@superwall.com to get access.",
          },
        }
      : undefined;

  const result = await createStudioActions(gated, { ...project, surfaces: [surface] }).run(
    "push",
    surface,
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /^Superwall for Agents is in private beta and isn't enabled for this app yet\./);
});

const PROJECTS = {
  data: [{ id: "9", applications: [{ id: 42, platform: "ios", apple_url_scheme: "acme" }] }],
  has_more: false,
};

test("appScheme takes the bound app's scheme from the dashboard", async () => {
  const api = await startApi();
  api.gate = (url) => (url.startsWith("/v2/projects") ? { status: 200, body: PROJECTS } : undefined);
  const project = boundProject();

  const scheme = await createStudioActions(framework, project).appScheme?.();

  assert.deepEqual(scheme, { scheme: "acme", source: "dashboard" });
});

test("appScheme names the Info.plist whose App Transport Security blocks the dev server", async () => {
  delete process.env.SUPERWALL_API_KEY;
  const project = scaffold();
  const plist = path.join(project.root, "App", "Info.plist");
  fs.mkdirSync(path.dirname(plist));
  fs.writeFileSync(
    plist,
    "<plist><dict><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>acme</string></array></dict></array></dict></plist>",
  );

  const scheme = await createStudioActions(framework, project).appScheme?.();

  assert.deepEqual(scheme, { scheme: "acme", source: "app", blocksLocalNetworking: plist });
});

test("samples carry the app's live properties and the products its project sells", async () => {
  const api = await startApi();
  api.gate = (url) =>
    url.startsWith("/v2/users/device-properties-sample?application_id=42")
      ? { status: 200, body: { properties: { osVersion: "18.0" }, live: true } }
      : url.startsWith("/v2/users/properties-sample?application_id=42")
        ? { status: 200, body: { properties: { plan: "free" } } }
        : url.startsWith("/v2/projects")
          ? { status: 200, body: PROJECTS }
          : url.startsWith("/v2/products?project_id=9")
            ? {
                status: 200,
                body: {
                  data: [
                    { identifier: "pro_annual", price: { amount: 5999, currency: "USD" } },
                    { price: { amount: 100, currency: "USD" } },
                  ],
                },
              }
            : undefined;
  const project = boundProject();

  const samples = await createStudioActions(framework, project).samples?.();

  assert.deepEqual(samples?.device, { osVersion: "18.0" });
  assert.deepEqual(samples?.user, { plan: "free" });
  assert.deepEqual(samples?.live, { device: true, user: false });
  assert.deepEqual(Object.keys(samples?.products ?? {}), ["pro_annual"]);
  assert.equal(samples?.products?.pro_annual?.price, "$59.99");
  assert.equal(samples?.unreachable, undefined);
});

test("samples say why the products could not be read, and keep the properties", async () => {
  const api = await startApi();
  api.gate = (url) =>
    url.startsWith("/v2/users/properties-sample")
      ? { status: 200, body: { properties: { plan: "free" }, live: true } }
      : url.startsWith("/v2/projects")
        ? { status: 200, body: PROJECTS }
        : url.startsWith("/v2/products")
          ? { status: 500, body: { error: "products are down" } }
          : undefined;
  const project = boundProject();

  const samples = await createStudioActions(framework, project).samples?.();

  assert.deepEqual(samples?.user, { plan: "free" });
  assert.deepEqual(samples?.live, { device: false, user: true });
  assert.equal(samples?.products, undefined);
  assert.match(samples?.unreachable ?? "", /500/);
});

test("a build that throws something other than an Error still fails the action with it", async () => {
  await startApi();
  const project = boundProject();
  const throwing: Framework = {
    ...framework,
    buildSnapshot: () => Promise.reject("the build crashed"),
  };

  const result = await createStudioActions(throwing, project).run("push", surface);

  assert.deepEqual(result, { ok: false, error: "the build crashed" });
});

test("imports from outside superwall/ are pushed with the source and warned about once", async () => {
  const api = await startApi();
  const project = boundProject();
  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));
  const external: Framework = {
    ...framework,
    buildSnapshot: async () => ({
      name: "Pro",
      snapshotId: "abc",
      html: "<html></html>",
      bytes: 13,
      htmlFile: "x",
      assets: [],
      assetBytes: 0,
      externalSources: ["../shared/theme.ts", "../shared/a.ts"],
    }),
  };

  const result = await createStudioActions(external, project).run("push", surface);
  selectRenderer({ mode: "text" });

  assert.deepEqual(result, { ok: true, version: 7, live: false });
  const shown = execFileSync("git", ["--git-dir", api.bare, "show", "main"], { encoding: "utf8" });
  assert.match(shown, /Superwall-Portable: false/);
  const warnings = calls.filter((call) => call.method === "warn").map((call) => String(call.value));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /^2 imports resolve outside superwall\/ \(\.\.\/shared\/a\.ts, \.\.\/shared\/theme\.ts\)/);
});

test("a project with no source to commit fails after the version is pushed, before any promote", async () => {
  const api = await startApi();
  const project = boundProject();
  fs.writeFileSync(path.join(project.superwallDir, ".gitignore"), "*\n");

  const steps: string[] = [];
  const result = await createStudioActions(framework, project).run("publish", surface, (step, state) =>
    steps.push(`${step}:${state}`),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /^No source files found in /);
  assert.deepEqual(steps.slice(-2), ["push:done", "source:start"]);
  assert.ok(api.calls.includes("POST /v2/paywalls/208540/versions"));
  assert.ok(!api.calls.some((call) => call.includes("/promote")));
});

const funnel: FrameworkSurface = { ...surface, kind: "funnel", id: "welcome" };

test("status reads a funnel's binding and lists no versions when the API returns none", async () => {
  const api = await startApi();
  api.gate = (url) => (url.endsWith("/versions") ? { status: 200, body: { object: "list" } } : undefined);
  const project = scaffold();
  writeApp(project.superwallDir, "ios", "42");
  writeBinding(project.superwallDir, "funnel", "welcome", "ios", { paywallId: "208542" });

  const status = await createStudioActions(framework, project).status(funnel);

  assert.equal(status.paywallId, "208542");
  assert.deepEqual(status.versions, []);
  assert.ok(api.calls.includes("GET /v2/paywalls/208542"));
});

const previewImages = (body: unknown, status = 200) => (url: string) =>
  url === "/v2/paywalls/208540/preview-images" ? { status, body } : undefined;

test("every captured page is a screenshot, the last one the App Store review render", async () => {
  const api = await startApi();
  api.gate = previewImages({
    status: "ready",
    pages: [
      { page_index: 0, page_name: "Welcome", kind: "page", url: "https://img.test/welcome.png" },
      { page_index: 1, page_name: null, kind: "page", url: "https://img.test/page-2.png" },
      { page_index: 2, page_name: "  Plans ", kind: "page", url: "https://img.test/plans.png" },
    ],
    apple_review_image: { url: "https://img.test/review.png", page_index: 2 },
  });

  assert.deepEqual(await createStudioActions(framework, boundProject()).screenshots?.(surface), [
    { label: "Welcome", url: "https://img.test/welcome.png" },
    { label: "Page 2", url: "https://img.test/page-2.png" },
    { label: "Plans", url: "https://img.test/review.png" },
  ]);
});

test("overlays keep the capture's name, else are numbered under the page they open on", async () => {
  const api = await startApi();
  api.gate = previewImages({
    status: "ready",
    pages: [
      { page_index: 0, page_name: "Plans", kind: "page", url: "https://img.test/plans.png" },
      { page_index: 0, kind: "overlay", url: "https://img.test/discount.png" },
      { page_index: 0, page_name: "Plans — Exit offer", kind: "overlay", url: "https://img.test/exit.png" },
      { page_index: 3, kind: "overlay", url: "https://img.test/orphan.png" },
      { page_index: 0, kind: "overlay" },
    ],
    apple_review_image: { url: "https://img.test/review.png", page_index: 0 },
  });

  assert.deepEqual(await createStudioActions(framework, boundProject()).screenshots?.(surface), [
    { label: "Plans", url: "https://img.test/review.png" },
    { label: "Plans · Overlay 1", url: "https://img.test/discount.png" },
    { label: "Plans — Exit offer", url: "https://img.test/exit.png" },
    { label: "Page 4 · Overlay 1", url: "https://img.test/orphan.png" },
  ]);
});

test("the review render falls back to the last page, or is the only page when no page matches", async () => {
  const api = await startApi();
  const actions = createStudioActions(framework, boundProject());

  api.gate = previewImages({
    status: "ready",
    pages: [
      { page_index: 0, url: "https://img.test/page-1.png" },
      { page_index: 1, url: "https://img.test/page-2.png" },
    ],
    apple_review_image: { url: "https://img.test/review.png", page_index: 7 },
  });
  assert.deepEqual(await actions.screenshots?.(surface), [
    { label: "Page 1", url: "https://img.test/page-1.png" },
    { label: "Page 2", url: "https://img.test/review.png" },
  ]);

  api.gate = previewImages({ status: "ready", pages: [], apple_review_image: { url: "https://img.test/review.png" } });
  assert.deepEqual(await actions.screenshots?.(surface), [
    { label: "Page 1", url: "https://img.test/review.png" },
  ]);
});

test("a page's own App Store render wins over its phone-sized capture", async () => {
  const api = await startApi();
  api.gate = previewImages({
    status: "ready",
    pages: [
      { page_index: 0, page_name: "Welcome", url: "https://img.test/welcome.png", app_store_image: { url: "https://img.test/welcome-1290.png" } },
      { page_index: 0, kind: "overlay", url: "https://img.test/sheet.png", app_store_image: { url: "https://img.test/sheet-1290.png" } },
      { page_index: 1, page_name: "Plans", url: "https://img.test/plans.png", app_store_image: null },
    ],
    apple_review_image: { url: "https://img.test/review.png", page_index: 1 },
  });

  assert.deepEqual(await createStudioActions(framework, boundProject()).screenshots?.(surface), [
    { label: "Welcome", url: "https://img.test/welcome-1290.png" },
    { label: "Welcome · Overlay 1", url: "https://img.test/sheet-1290.png" },
    { label: "Plans", url: "https://img.test/review.png" },
  ]);
});

test("without a review render every page keeps its own capture", async () => {
  const api = await startApi();
  api.gate = previewImages({
    status: "ready",
    pages: [{ url: "https://img.test/page-1.png" }, { page_name: "Paywall" }],
    apple_review_image: null,
  });

  assert.deepEqual(await createStudioActions(framework, boundProject()).screenshots?.(surface), [
    { label: "Page 1", url: "https://img.test/page-1.png" },
  ]);
});

test("there is no screenshot while the capture runs, when the API refuses one, or for an unbound surface", async () => {
  const api = await startApi();
  const project = boundProject();
  const actions = createStudioActions(framework, project);

  api.gate = previewImages({ status: "pending" });
  assert.equal(await actions.screenshots?.(surface), undefined);

  api.gate = previewImages({ error: "no capture for this paywall" }, 400);
  assert.equal(await actions.screenshots?.(surface), undefined);

  api.gate = previewImages({ status: "ready", pages: [], apple_review_image: null });
  assert.equal(await actions.screenshots?.(surface), undefined);

  const calls = api.calls.length;
  assert.equal(await actions.screenshots?.(funnel), undefined);
  assert.equal(api.calls.length, calls);
});

test("a screenshot request that fails for any other reason is not swallowed", async () => {
  const api = await startApi();
  api.gate = previewImages({ error: "boom" }, 500);

  await assert.rejects(createStudioActions(framework, boundProject()).screenshots?.(surface) ?? Promise.resolve(), /500/);
});
