import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { runPushPipeline, type PushContext } from "@/core/paywalls/pipeline/push";
import { createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import type {
  Framework,
  FrameworkProject,
  FrameworkSurface,
} from "@/core/paywalls/project/framework";
import { readLock, writeApp, writeBinding } from "@/core/paywalls/project/lock";
import { ui, useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

selectRenderer({ mode: "json" });

const dirs: string[] = [];
const servers: http.Server[] = [];

const surfaceOf = (id: string, kind: "paywall" | "funnel" = "paywall"): FrameworkSurface => ({
  kind,
  id,
  dir: `/tmp/${id}`,
  configFile: `/tmp/${id}/config.ts`,
  routes: [],
});

function scaffold(ids: string[] = ["plus-upgrade"]): FrameworkProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-pipeline-"));
  dirs.push(dir);
  writeApp(dir, "ios", "42");
  for (const id of ids) {
    writeBinding(dir, "paywall", id, "ios", { paywallId: `208${ids.indexOf(id)}` });
  }
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
  paths: string[];
  bodies: Record<string, string>;
  routes: Record<string, Route>;
  api: SuperwallApi;
  bare: string;
}

async function fakeApi(routes: Record<string, Route> = {}): Promise<Fake> {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-pipeline-bare-"));
  dirs.push(bare);
  execFileSync("git", ["init", "--bare", "--initial-branch", "main", bare]);
  const fake: Fake = { calls: [], paths: [], bodies: {}, routes, api: createSuperwallApi({} as never), bare };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      const url = req.url ?? "";
      const kind = url.startsWith("/v2/projects")
        ? "projects"
        : url.startsWith("/v2/products")
          ? "products"
          : url.startsWith("/v2/paywalls?")
            ? "paywalls"
            : url === "/v2/paywalls" && req.method === "POST"
              ? "create"
              : url.endsWith("/assets")
                ? "assets"
                : url.endsWith("/promote")
                  ? "promote"
                  : url.endsWith("/source-access")
                    ? "access"
                    : url.endsWith("/source-commit")
                      ? "link"
                      : url.endsWith("/versions") && req.method === "GET"
                        ? "history"
                        : url.endsWith("/versions")
                          ? "versions"
                        : /^\/v2\/paywalls\/[^/]+$/.test(url) && req.method === "GET"
                          ? "live"
                          : "other";
      fake.calls.push(kind);
      fake.paths.push(url);
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
        history: { object: "list", data: [] },
        paywalls: { data: [] },
        create: { id: 9 },
        projects: { data: [{ id: "9", applications: [{ id: "42" }] }] },
        products: {
          data: [
            { identifier: "pro_999_month", price: { amount: 999, currency: "USD" } },
            { identifier: "pro_5999_year", price: { amount: 5999, currency: "USD" } },
          ],
        },
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
  fake.api = createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_test_pipeline",
    host: `http://127.0.0.1:${port}`,
    createdAt: new Date().toISOString(),
  });
  return fake;
}

const built = (over: Record<string, unknown> = {}) => ({
  name: "Pro",
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

function contextFor(api: SuperwallApi): PushContext {
  return { api, outputMode: "json", interactive: false };
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

  assert.deepEqual(fake.calls, ["projects", "products", "live", "versions", "access", "link"]);
});

test("a product Superwall has no record of stops the push before any version exists", async () => {
  const project = scaffold();
  const fake = await fakeApi({ products: { body: { data: [] } } });

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: true,
      load: async () =>
        frameworkFor(project, {
          buildSnapshot: async () => built({ products: { annual: "pro_5999_year" } }),
        }),
    }),
    /plus-upgrade: annual → pro_5999_year/,
  );

  // a published version is immutable, so nothing may reach Superwall
  assert.deepEqual(fake.calls, ["projects", "products"]);
});

test("an unreachable catalogue is not treated as an empty one", async () => {
  const project = scaffold();
  const fake = await fakeApi({ projects: { status: 500, body: {} } });

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ products: { annual: "pro_5999_year" } }),
      }),
  });

  assert.ok(fake.calls.includes("versions"), "the push proceeds rather than blaming products");
});

test("publish promotes only after the source push lands", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, [
    "projects",
    "products",
    "live",
    "versions",
    "access",
    "link",
    "promote",
  ]);
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

  assert.deepEqual(fake.calls, [
    "projects",
    "products",
    "live",
    "assets",
    "versions",
    "access",
    "link",
  ]);
  const version: unknown = JSON.parse(fake.bodies.versions ?? "{}");
  assert.deepEqual(Reflect.get(Object(version), "assets"), [
    {
      url: "https://user-content.superwalleditor.com/user-content/hl/42/aaa.png",
      mime_type: "image/png",
    },
  ]);
});

test("a build failure stops the surface before anything is written to Superwall", async () => {
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
  assert.deepEqual(fake.calls, ["projects", "products"], "only the catalogue the build needs is read");
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
  assert.deepEqual(fake.calls, ["projects", "products"]);
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
    assert.deepEqual(fake.calls, ["projects", "products", "live", "assets"]);
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
  assert.deepEqual(fake.calls, ["projects", "products", "live", "versions"]);
});

test("a failed live-version lookup never fails the push — the version is what matters", async () => {
  const project = scaffold();
  const fake = await fakeApi({ live: { status: 500, body: { message: "down" } } });

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, [
    "projects",
    "products",
    "live",
    "versions",
    "access",
    "link",
    "promote",
  ]);
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
  assert.deepEqual(fake.calls, ["projects", "products", "live", "versions", "access", "link", "link"]);
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
  assert.deepEqual(fake.calls, ["projects", "products", "live", "versions", "access"]);
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
  assert.deepEqual(fake.calls, [
    "projects",
    "products",
    "live",
    "versions",
    "access",
    "link",
    "promote",
  ]);
});

test("a tree far past the old JSON cap publishes fine over git", async () => {
  const project = scaffold();
  fs.writeFileSync(path.join(project.superwallDir, "stray.bin"), Buffer.alloc(9 * 1024 * 1024, 4));
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, [
    "projects",
    "products",
    "live",
    "versions",
    "access",
    "link",
    "promote",
  ]);
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
    fake.calls.filter((call) => !["live", "projects", "products"].includes(call)),
    ["versions"],
  );
});

test("--only narrows the run to one surface", async () => {
  const project = scaffold(["alpha", "beta"]);
  const fake = await fakeApi();
  const steps: string[] = [];

  await runPushPipeline(contextFor(fake.api), {
    ids: ["beta"],
    promote: false,
    load: async () => frameworkFor(project, {}, steps),
  });

  assert.deepEqual(steps, ["build"]);
  assert.deepEqual(fake.calls, ["projects", "products", "live", "versions", "access", "link"]);
});

test("the source bundle is collected once and reused for every surface", async () => {
  const project = scaffold(["alpha", "beta"]);
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(fake.calls, [
    "projects",
    "products",
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

  await runPushPipeline(
    { ...contextFor(fake.api), interactive: true },
    {
      promote: false,
      load: async () => frameworkFor(project),
    },
  );

  assert.deepEqual(fake.calls, ["projects", "products", "live", "versions", "access", "link"]);
});

test("rich output renders through the spinner on success and on failure", async () => {
  const project = scaffold();
  const ok = await fakeApi();

  await runPushPipeline(
    { ...contextFor(ok.api), outputMode: "rich" },
    {
      promote: false,
      load: async () => frameworkFor(project),
    },
  );
  assert.deepEqual(ok.calls, ["projects", "products", "live", "versions", "access", "link"]);

  const failing = scaffold();
  const bad = await fakeApi({ versions: { status: 500, body: {} } });
  await assert.rejects(
    runPushPipeline(
      { ...contextFor(bad.api), outputMode: "rich" },
      {
        promote: false,
        load: async () => frameworkFor(failing),
      },
    ),
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
  assert.deepEqual(fake.calls, ["projects", "products", "live", "assets"]);
});

test("-m threads the publish note into the source push verbatim", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  const note = "Ship the Q3 pricing test\n\nRolls the toggle default to plus.";

  await runPushPipeline(contextFor(fake.api), {
    message: note,
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

test("an empty -m adds no body to the commit", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    message: "",
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
    runPushPipeline(contextFor(fake.api), {
      message: "x".repeat(2001),
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

  await runPushPipeline(contextFor(fake.api), {
    message: note,
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
    "plus-upgrade": { ios: { paywallId: "2080" } },
  });
});

test("a declared rename carries the live paywall id through the whole push", async () => {
  const project = scaffold(["plus-upgrade"]);
  const renamed = surfaceOf("pro-upgrade");
  project.surfaces = [renamed];
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    renames: ["plus-upgrade=pro-upgrade"],
    promote: false,
    load: async () => frameworkFor(project),
  });

  assert.deepEqual(readLock(project.superwallDir).paywalls, {
    "pro-upgrade": { ios: { paywallId: "2080", snapshot: "abcdef0123456789" } },
  });
  assert.ok(fake.calls.includes("versions"), "the renamed surface still pushes a version");
});

test("a surface whose snapshot already matches production is skipped entirely", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: {
      body: {
        id: "2080",
        version: 7,
        paywall_url: `https://r/x/headless/2080/${"a".repeat(64)}.html`,
      },
    },
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ snapshotId: "a".repeat(64) }),
      }),
  });

  assert.deepEqual(fake.calls, ["projects", "products", "live", "history"]);
});

const elite = { primary: "elite1w", stripePrimary: "stripe_elite1w" };

const eliteCatalogue = {
  body: {
    data: [
      { identifier: "elite1w", platform: "ios", store: "app_store" },
      { identifier: "stripe_elite1w", platform: "custom", store: "custom" },
    ],
  },
};

const pushedWith = (snapshot: string, stripeStore: string) => ({
  body: {
    object: "list",
    data: [
      {
        version: 6,
        snapshot_id: "0".repeat(64),
        products: [{ reference_name: "stripePrimary", identifier: "stripe_elite1w", store: "custom" }],
      },
      {
        version: 7,
        snapshot_id: snapshot,
        products: [
          { reference_name: "primary", identifier: "elite1w", store: "app-store" },
          { reference_name: "stripePrimary", identifier: "stripe_elite1w", store: stripeStore },
        ],
      },
    ],
  },
});

const liveOn = (snapshot: string) => ({
  body: { id: "2080", version: 7, paywall_url: `https://r/x/headless/2080/${snapshot}.html` },
});

test("a snapshot already pushed is pushed again when its version carries the wrong store", async () => {
  const project = scaffold();
  const snapshot = "a".repeat(64);
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "ios", {
    paywallId: "2080",
    snapshot,
  });
  const fake = await fakeApi({
    products: eliteCatalogue,
    live: liveOn(snapshot),
    history: pushedWith(snapshot, "app-store"),
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ snapshotId: snapshot, products: elite }),
      }),
  });

  assert.ok(fake.calls.includes("versions"), "the version is pushed again");
  assert.ok(fake.calls.includes("promote"), "and promoted, so the corrected stores go live");
  const body: unknown = JSON.parse(fake.bodies.versions ?? "{}");
  assert.deepEqual(Reflect.get(Object(body), "products"), [
    { store: "app-store", identifier: "elite1w", reference_name: "primary" },
    { store: "custom", identifier: "stripe_elite1w", reference_name: "stripePrimary" },
  ]);
});

test("a corrected draft is not pushed again while production still has the old stores", async () => {
  const project = scaffold();
  const snapshot = "a".repeat(64);
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "ios", {
    paywallId: "2080",
    snapshot,
  });
  const fake = await fakeApi({
    products: eliteCatalogue,
    live: liveOn("b".repeat(64)),
    history: pushedWith(snapshot, "custom"),
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ snapshotId: snapshot, products: elite }),
      }),
  });

  assert.deepEqual(fake.calls, ["projects", "products", "live", "history"]);
});

test("a version whose source failed is pushed again first when its stores were wrong", async () => {
  const project = scaffold();
  const snapshot = "a".repeat(64);
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "ios", {
    paywallId: "2080",
    snapshot,
    sourcePending: 7,
  });
  const fake = await fakeApi({
    products: eliteCatalogue,
    live: liveOn("b".repeat(64)),
    history: pushedWith(snapshot, "app-store"),
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ snapshotId: snapshot, products: elite }),
      }),
  });

  assert.deepEqual(fake.calls, ["projects", "products", "live", "history", "versions", "access", "link"]);
  assert.equal(readLock(project.superwallDir).paywalls["plus-upgrade"]?.ios?.sourcePending, undefined);
});

test("a changed snapshot still ships when production is on an older one", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: {
      body: {
        id: "2080",
        version: 7,
        paywall_url: `https://r/x/headless/2080/${"b".repeat(64)}.html`,
      },
    },
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ snapshotId: "a".repeat(64) }),
      }),
  });

  assert.deepEqual(fake.calls, ["projects", "products", "live", "versions", "access", "link"]);
});

test("--id selects several surfaces, and an unknown id names what the project has", async () => {
  const project = scaffold(["alpha", "beta", "gamma"]);
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    ids: ["alpha", "gamma"],
    promote: false,
    load: async () => frameworkFor(project),
  });
  assert.equal(fake.calls.filter((call) => call === "versions").length, 2);

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      ids: ["nope"],
      promote: false,
      load: async () => frameworkFor(project),
    }),
    /No paywall or funnel named "nope".*alpha, beta, gamma/s,
  );
});

test("--id accepts a comma-separated list", async () => {
  const project = scaffold(["alpha", "beta", "gamma"]);
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    ids: ["alpha,beta"],
    promote: false,
    load: async () => frameworkFor(project),
  });

  assert.equal(fake.calls.filter((call) => call === "versions").length, 2);
});

test("pushing twice with no edits skips the second run — the version already exists", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: {
      body: {
        id: "2080",
        version: 11,
        paywall_url: `https://r/x/headless/2080/${"c".repeat(64)}.html`,
      },
    },
  });
  const load = async () => frameworkFor(project);

  await runPushPipeline(contextFor(fake.api), { promote: false, load });
  assert.deepEqual(fake.calls, ["projects", "products", "live", "versions", "access", "link"]);

  fake.calls.length = 0;
  await runPushPipeline(contextFor(fake.api), { promote: false, load });
  assert.deepEqual(
    fake.calls,
    ["projects", "products", "live", "history"],
    "nothing to push: the built snapshot is already a version",
  );
});

test("publish refuses to re-push an identical version and points at promote instead", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: {
      body: {
        id: "2080",
        version: 11,
        paywall_url: `https://r/x/headless/2080/${"c".repeat(64)}.html`,
      },
    },
  });
  const load = async () => frameworkFor(project);

  await runPushPipeline(contextFor(fake.api), { promote: false, load });
  fake.calls.length = 0;

  await runPushPipeline(contextFor(fake.api), { promote: true, load });

  assert.deepEqual(
    fake.calls,
    ["projects", "products", "live", "history"],
    "no second version push, and no promote of an old push",
  );
});

test("publish still pushes and promotes when the code actually changed", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  let snapshot = "a".repeat(64);

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, { buildSnapshot: async () => built({ snapshotId: snapshot }) }),
  });
  fake.calls.length = 0;

  snapshot = "d".repeat(64);
  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () =>
      frameworkFor(project, { buildSnapshot: async () => built({ snapshotId: snapshot }) }),
  });

  assert.deepEqual(fake.calls, [
    "projects",
    "products",
    "live",
    "versions",
    "access",
    "link",
    "promote",
  ]);
});

test("push stays quiet about a pending promote — that hint belongs to publish", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    live: {
      body: {
        id: "2080",
        version: 11,
        paywall_url: `https://r/x/headless/2080/${"c".repeat(64)}.html`,
      },
    },
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
    live: {
      body: { id: "2080", version: 7, paywall_url: `https://r/x/headless/2080/${snapshot}.html` },
    },
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
    assert.deepEqual(
      fake.calls,
      ["projects", "products", "live", "history"],
      "already live: nothing to push, nothing to promote",
    );
    assert.deepEqual(warnings, [], "and nothing to warn about");
  } finally {
    ui.warn = warn;
  }
});

test("several pending paywalls are named in one hint, with a single promote command", async () => {
  const project = scaffold(["alpha", "beta", "gamma"]);
  const fake = await fakeApi({
    live: {
      body: {
        id: "2080",
        version: 11,
        paywall_url: `https://r/x/headless/2080/${"c".repeat(64)}.html`,
      },
    },
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

const declaring = (
  project: FrameworkProject,
  platforms: Record<string, string[] | undefined>,
  over: Partial<Framework> = {},
  steps: string[] = [],
): Framework => ({
  ...frameworkFor(project, over, steps),
  studioProject: async () => ({
    surfaces: project.surfaces.map((surface) => ({
      kind: surface.kind,
      id: surface.id,
      products: {},
      platforms: platforms[surface.id],
    })),
  }),
});

test("a surface declared for two platforms pushes one version per app, each built against its own asset host", async () => {
  const project = scaffold();
  writeApp(project.superwallDir, "android", "43");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "android", { paywallId: "3080" });
  const fake = await fakeApi();
  const hosts: (string | undefined)[] = [];

  await runPushPipeline(contextFor(fake.api), {
    promote: true,
    load: async () =>
      declaring(
        project,
        { "plus-upgrade": ["ios", "android"] },
        {
          buildSnapshot: async (_project, _surface, options) => {
            hosts.push(options?.assetBaseUrl);
            return built();
          },
        },
      ),
  });

  assert.deepEqual(hosts, [
    "https://user-content.superwalleditor.com/user-content/hl/42",
    "https://user-content.superwalleditor.com/user-content/hl/43",
  ]);
  assert.equal(fake.calls.filter((call) => call === "versions").length, 2);
  assert.equal(fake.calls.filter((call) => call === "promote").length, 2);
  assert.deepEqual(readLock(project.superwallDir).paywalls["plus-upgrade"], {
    ios: { paywallId: "2080", snapshot: "abcdef0123456789" },
    android: { paywallId: "3080", snapshot: "abcdef0123456789" },
  });
});

test("--platform narrows a multi-platform push to one app", async () => {
  const project = scaffold();
  writeApp(project.superwallDir, "android", "43");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "android", { paywallId: "3080" });
  const fake = await fakeApi();
  const steps: string[] = [];

  await runPushPipeline(contextFor(fake.api), {
    platforms: ["android"],
    promote: false,
    load: async () => declaring(project, { "plus-upgrade": ["ios", "android"] }, {}, steps),
  });

  assert.deepEqual(steps, ["build"]);
  assert.equal(fake.calls.filter((call) => call === "versions").length, 1);
  const lock = readLock(project.superwallDir).paywalls["plus-upgrade"];
  assert.equal(lock?.android?.snapshot, "abcdef0123456789");
  assert.equal(lock?.ios?.snapshot, undefined);
});

test("a second platform named in config.ts binds its app on the fly when the account has exactly one", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    projects: {
      body: {
        data: [
          {
            id: "9",
            applications: [
              { id: "42", platform: "ios" },
              { id: "43", platform: "android" },
            ],
          },
        ],
      },
    },
  });

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => declaring(project, { "plus-upgrade": ["ios", "android"] }),
  });

  const lock = readLock(project.superwallDir);
  assert.deepEqual(lock.apps, { ios: "42", android: "43" });
  assert.equal(
    lock.paywalls["plus-upgrade"]?.android?.paywallId,
    "9",
    "created on the android app",
  );
  assert.equal(fake.calls.filter((call) => call === "versions").length, 2);
});

test("a surface that names no platform while the project has several stops before anything is built", async () => {
  const project = scaffold(["plus-upgrade", "quiet"]);
  writeApp(project.superwallDir, "android", "43");
  const fake = await fakeApi();
  const steps: string[] = [];

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () => declaring(project, { "plus-upgrade": ["ios"] }, {}, steps),
    }),
    /`quiet` doesn't say which platforms it's for[\s\S]*ios, android/,
  );
  assert.deepEqual(steps, []);
  assert.deepEqual(
    fake.calls,
    [],
    "both apps are already in the lock, so nothing is even looked up",
  );
});

test("each platform's version carries its own product ids and store", async () => {
  const project = scaffold();
  writeApp(project.superwallDir, "android", "43");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "android", { paywallId: "3080" });
  const fake = await fakeApi({
    products: {
      body: {
        data: [
          { identifier: "pro_5999_year", price: { amount: 5999, currency: "USD" } },
          { identifier: "pro_5999_year_play", price: { amount: 5999, currency: "USD" } },
        ],
      },
    },
  });
  const bodies: string[] = [];

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      declaring(
        project,
        { "plus-upgrade": ["ios", "android"] },
        {
          buildSnapshot: async (_project, _surface, options) =>
            built({
              products: {
                annual: options?.platform === "android" ? "pro_5999_year_play" : "pro_5999_year",
              },
            }),
        },
      ),
  });

  bodies.push(fake.bodies.versions ?? "");
  const last: unknown = JSON.parse(bodies[0] ?? "{}");
  assert.deepEqual(Reflect.get(Object(last), "products"), [
    { store: "play-store", identifier: "pro_5999_year_play", reference_name: "annual" },
  ]);
});

test("a product the catalogue records as custom is pushed as custom, and the push says so", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    products: {
      body: {
        data: [
          { identifier: "elite1w", platform: "ios", store: "app_store" },
          { identifier: "stripe_elite1w", platform: "ios", store: "custom" },
        ],
      },
    },
  });
  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));

  try {
    await runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () =>
        frameworkFor(project, {
          buildSnapshot: async () =>
            built({ products: { primary: "elite1w", stripePrimary: "stripe_elite1w" } }),
        }),
    });
  } finally {
    selectRenderer({ mode: "json" });
  }

  const body: unknown = JSON.parse(fake.bodies.versions ?? "{}");
  assert.deepEqual(Reflect.get(Object(body), "products"), [
    { store: "app-store", identifier: "elite1w", reference_name: "primary" },
    { store: "custom", identifier: "stripe_elite1w", reference_name: "stripePrimary" },
  ]);
  assert.ok(
    calls.some(
      (call) => typeof call.value === "string" && call.value.includes("stripePrimary → custom"),
    ),
  );
});

test("the build is handed the project's catalogue, so a Stripe product can be priced on device", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    products: {
      body: { data: [{ identifier: "live:price_1:14days-free", platform: "stripe", price: { amount: 5999, currency: "USD" } }] },
    },
  });
  const catalogues: unknown[] = [];

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async (_project, _surface, options) => {
          catalogues.push(options?.catalogue);
          return built({ products: { card14: "live:price_1:14days-free" } });
        },
      }),
  });

  assert.equal(
    Reflect.get(Object(Reflect.get(Object(catalogues[0]), "live:price_1:14days-free")), "price"),
    "$59.99",
  );
  const body: unknown = JSON.parse(fake.bodies.versions ?? "{}");
  assert.deepEqual(Reflect.get(Object(body), "products"), [
    { store: "stripe", identifier: "live:price_1:14days-free", reference_name: "card14" },
  ]);
});

test("the settings a build resolves from config.ts travel with the version", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  const settings = {
    presentation_style: { type: "POPUP" as const, width: 80, height: 60, corner_radius: 15 },
    feature_gating: "gated" as const,
    on_device_cache: true,
    scroll_enabled: false,
    game_controller_enabled: false,
    introductory_offer_eligibility: "always_eligible" as const,
  };

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => frameworkFor(project, { buildSnapshot: async () => built({ settings }) }),
  });

  const version: unknown = JSON.parse(fake.bodies.versions ?? "{}");
  for (const [key, value] of Object.entries(settings)) {
    assert.deepEqual(Reflect.get(Object(version), key), value, key);
  }
});

test("the locales a surface speaks travel with the version", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () =>
      frameworkFor(project, {
        buildSnapshot: async () => built({ locales: ["de", "en", "es"] }),
      }),
  });

  const version: unknown = JSON.parse(fake.bodies.versions ?? "{}");
  assert.deepEqual(Reflect.get(Object(version), "locales"), ["de", "en", "es"]);
});

test("a surface with no catalogs sends no locales at all", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => frameworkFor(project, { buildSnapshot: async () => built({ locales: [] }) }),
  });

  const version: unknown = JSON.parse(fake.bodies.versions ?? "{}");
  assert.equal("locales" in Object(version), false);
});

test("an app in an organization the account doesn't belong to still has its products checked", async () => {
  const project = scaffold();
  const fake = await fakeApi({
    projects: {
      body: {
        data: [],
        has_more: false,
        id: "9",
        organization_id: 1,
        applications: [{ id: "42" }],
      },
    },
    paywalls: { body: { data: [{ project_id: "9" }] } },
    products: { body: { data: [] } },
  });

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () =>
        frameworkFor(project, {
          buildSnapshot: async () => built({ products: { annual: "pro_5999_year" } }),
        }),
    }),
    /plus-upgrade: annual → pro_5999_year/,
  );
  assert.ok(!fake.calls.includes("versions"));
});

test("a same-named paywall the lock doesn't bind stops the push, and the printed lock line resolves it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-pipeline-"));
  dirs.push(dir);
  writeApp(dir, "ios", "42");
  const project: FrameworkProject = {
    root: dir,
    superwallDir: dir,
    marker: "package.json",
    packageName: "acme-paywalls",
    surfaces: [surfaceOf("plus-upgrade")],
    diagnostics: [],
  };
  const fake = await fakeApi({
    paywalls: {
      body: { data: [{ id: 274523, identifier: "plus-upgrade", metadata: { headless: "true" } }] },
    },
  });

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), {
      promote: false,
      load: async () => frameworkFor(project),
    }),
    /already has a paywall `plus-upgrade` \(274523\)[\s\S]*"plus-upgrade": \{ "ios": \{ "paywallId": "274523" \} \}[\s\S]*rename the directory/,
  );
  assert.ok(!fake.calls.includes("versions"), "nothing is pushed to someone else's paywall");
  assert.ok(!fake.calls.includes("create"), "nor is a duplicate created behind the user's back");
  assert.deepEqual(readLock(dir).paywalls, {});

  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "274523" });
  fake.calls.length = 0;
  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    load: async () => frameworkFor(project),
  });
  assert.ok(fake.calls.includes("versions"));
});

test("a version whose source failed is retried on the next push, not skipped as already pushed", async () => {
  const project = scaffold();
  const fake = await fakeApi({ link: { status: 422, body: { message: "not yet" } } });
  const load = async () => frameworkFor(project);

  await assert.rejects(runPushPipeline(contextFor(fake.api), { promote: false, load }), /not yet/);
  assert.deepEqual(readLock(project.superwallDir).paywalls["plus-upgrade"]?.ios, {
    paywallId: "2080",
    snapshot: "abcdef0123456789",
    sourcePending: 7,
  });

  delete fake.routes.link;
  fake.calls.length = 0;
  await runPushPipeline(contextFor(fake.api), { promote: false, load });

  assert.deepEqual(
    fake.calls.filter((call) => call !== "projects"),
    ["products", "live", "history", "access", "link"],
  );
  assert.deepEqual(readLock(project.superwallDir).paywalls["plus-upgrade"]?.ios, {
    paywallId: "2080",
    snapshot: "abcdef0123456789",
  });
});

test("publish after a source failure finishes the source before promoting, and never hints a bare promote", async () => {
  const project = scaffold();
  const fake = await fakeApi({ link: { status: 422, body: { message: "not yet" } } });
  const load = async () => frameworkFor(project);
  const warnings: string[] = [];
  const warn = ui.warn;
  ui.warn = (message: string) => warnings.push(message);

  try {
    await assert.rejects(runPushPipeline(contextFor(fake.api), { promote: false, load }));
    delete fake.routes.link;
    fake.calls.length = 0;
    warnings.length = 0;
    await runPushPipeline(contextFor(fake.api), { promote: true, load });

    assert.deepEqual(
      fake.calls.filter((call) => call !== "projects"),
      ["products", "live", "history", "access", "link", "promote"],
    );
    assert.deepEqual(JSON.parse(fake.bodies.promote ?? "{}"), { version: 7 });
    assert.deepEqual(warnings, []);
  } finally {
    ui.warn = warn;
  }
});

test("without git nothing is created — the version would have no source", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  const savedPath = process.env.PATH;
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-no-git-"));
  dirs.push(process.env.PATH);

  try {
    await assert.rejects(
      runPushPipeline(contextFor(fake.api), { promote: true, load: async () => frameworkFor(project) }),
      /requires git/,
    );
  } finally {
    process.env.PATH = savedPath;
  }
  assert.ok(!fake.calls.includes("versions"));
});

test("a source tree over the size limit fails before any version exists", async () => {
  const project = scaffold();
  const fd = fs.openSync(path.join(project.superwallDir, "dump.bin"), "w");
  fs.ftruncateSync(fd, 300 * 1024 * 1024);
  fs.closeSync(fd);
  const fake = await fakeApi();

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), { promote: false, load: async () => frameworkFor(project) }),
    /over the 250 MB limit[\s\S]*dump\.bin/,
  );
  assert.ok(!fake.calls.includes("versions"));
});

test("--overwrite-source replaces a remote source this project never synced with", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-pipeline-other-"));
  dirs.push(other);
  execFileSync("git", ["clone", "--quiet", fake.bare, other]);
  fs.writeFileSync(path.join(other, "theirs.ts"), "theirs\n");
  execFileSync("git", ["-C", other, "add", "-A"]);
  execFileSync("git", ["-C", other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "theirs"]);
  execFileSync("git", ["-C", other, "push", "--quiet", "origin", "HEAD:main"]);
  const load = async () => frameworkFor(project);

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), { promote: false, load }),
    /theirs\.ts[\s\S]*--overwrite-source/,
  );

  await runPushPipeline(contextFor(fake.api), { promote: false, overwriteSource: true, load });
  const tracked = execFileSync("git", ["--git-dir", fake.bare, "ls-tree", "-r", "--name-only", "main"], {
    encoding: "utf8",
  });
  assert.ok(!tracked.includes("theirs.ts"));
  assert.match(tracked, /superwall\.lock/);
});

const unchanged = {
  live: { body: { id: "2080", version: 7, paywall_url: `https://r/x/headless/2080/${"a".repeat(64)}.html` } },
};
/** The calls after the catalogue lookups, whose count depends on what earlier tests cached. */
const writes = (fake: Fake) => fake.calls.filter((call) => call !== "projects" && call !== "products");
const sameBuild = (project: FrameworkProject) => async () =>
  frameworkFor(project, { buildSnapshot: async () => built({ snapshotId: "a".repeat(64) }) });

test("--existing skips a surface superwall.lock does not bind instead of creating it", async () => {
  const project = scaffold(["bound"]);
  project.surfaces.push(surfaceOf("fresh"));
  const fake = await fakeApi();
  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));

  try {
    await runPushPipeline(contextFor(fake.api), {
      promote: false,
      existing: true,
      load: async () => frameworkFor(project),
    });
  } finally {
    selectRenderer({ mode: "json" });
  }

  assert.ok(!fake.calls.includes("create"));
  assert.equal(fake.calls.filter((call) => call === "versions").length, 1);
  assert.equal(readLock(project.superwallDir).paywalls.fresh, undefined);
  assert.ok(JSON.stringify(calls).includes("fresh skipped"));
});

test("--source pushes the project source on its own when no paywall built differently", async () => {
  const project = scaffold();
  fs.mkdirSync(path.join(project.superwallDir, "design"));
  fs.writeFileSync(path.join(project.superwallDir, "DESIGN.md"), "# Design system\n");
  const fake = await fakeApi(unchanged);

  await runPushPipeline(contextFor(fake.api), { promote: true, source: true, message: "Docs", load: sameBuild(project) });

  assert.deepEqual(writes(fake), ["live", "history", "access"]);
  const log = execFileSync("git", ["--git-dir", fake.bare, "log", "-1", "--format=%B", "main"], { encoding: "utf8" });
  assert.match(log, /^publish project source\n\nDocs\n/);
  const tracked = execFileSync("git", ["--git-dir", fake.bare, "ls-tree", "-r", "--name-only", "main"], { encoding: "utf8" });
  assert.match(tracked, /DESIGN\.md/);

  fake.calls.length = 0;
  await runPushPipeline(
    { ...contextFor(fake.api), outputMode: "rich" },
    { promote: false, source: true, load: sameBuild(project) },
  );
  assert.deepEqual(writes(fake), ["live", "history", "access"], "nothing new: the source is unchanged");
});

test("--source rides along with a paywall that changed: one source push, linked to its version", async () => {
  const project = scaffold();
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), { promote: false, source: true, load: async () => frameworkFor(project) });

  assert.deepEqual(writes(fake), ["live", "versions", "access", "link"]);
});

test("--source needs a paywall on Superwall to push through, and a source tree it can send", async () => {
  const project = scaffold([]);
  project.surfaces.push(surfaceOf("fresh"));
  const fake = await fakeApi(unchanged);

  await assert.rejects(
    runPushPipeline(contextFor(fake.api), { promote: false, existing: true, source: true, load: sameBuild(project) }),
    /--source needs a paywall that is already on Superwall/,
  );

  const big = scaffold();
  const fd = fs.openSync(path.join(big.superwallDir, "dump.bin"), "w");
  fs.ftruncateSync(fd, 300 * 1024 * 1024);
  fs.closeSync(fd);
  await assert.rejects(
    runPushPipeline(contextFor(fake.api), { promote: false, source: true, load: sameBuild(big) }),
    /over the 250 MB limit/,
  );
});

test("a literal a design token holds is a warning, never a stop", async () => {
  const project = scaffold();
  fs.mkdirSync(path.join(project.superwallDir, "design"));
  fs.writeFileSync(path.join(project.superwallDir, "design", "tokens.css"), ":root { --color-accent: #46d7d4; }\n");
  const surface = project.surfaces[0]!;
  surface.dir = path.join(project.superwallDir, "paywalls", surface.id);
  fs.mkdirSync(path.join(surface.dir, "app"), { recursive: true });
  fs.writeFileSync(path.join(surface.dir, "app", "theme.css"), ".a { color: #46d7d4; }\n");
  const fake = await fakeApi();
  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));

  try {
    await runPushPipeline(contextFor(fake.api), { promote: false, load: async () => frameworkFor(project) });
  } finally {
    selectRenderer({ mode: "json" });
  }

  assert.ok(JSON.stringify(calls).includes("var(--color-accent)"));
  assert.ok(fake.calls.includes("versions"));
});

test("--existing skips a platform superwall.lock does not bind without asking for an app on it", async () => {
  const project = scaffold();
  const fake = await fakeApi();
  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));

  try {
    await runPushPipeline(contextFor(fake.api), {
      promote: false,
      existing: true,
      load: async () => declaring(project, { "plus-upgrade": ["ios", "android"] }),
    });
  } finally {
    selectRenderer({ mode: "json" });
  }

  assert.equal(fake.calls.filter((call) => call === "versions").length, 1);
  assert.deepEqual(readLock(project.superwallDir).apps, { ios: "42" });
  assert.ok(JSON.stringify(calls).includes("plus-upgrade skipped"));
});

test("--existing with nothing bound pushes nothing and binds no app", async () => {
  const project = scaffold([]);
  project.surfaces.push(surfaceOf("fresh"));
  const fake = await fakeApi();

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    existing: true,
    platforms: ["android"],
    load: async () => declaring(project, { fresh: ["ios", "android"] }),
  });

  assert.deepEqual(fake.calls, []);
  assert.deepEqual(readLock(project.superwallDir).apps, { ios: "42" });
});

const twoApps = (project: FrameworkProject) => {
  writeApp(project.superwallDir, "android", "43");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "android", { paywallId: "3080" });
};

test("--source pushes every app's source repo, through one of its paywalls", async () => {
  const project = scaffold();
  twoApps(project);
  const fake = await fakeApi(unchanged);

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    source: true,
    load: async () => declaring(project, { "plus-upgrade": ["ios", "android"] }, { buildSnapshot: async () => built({ snapshotId: "a".repeat(64) }) }),
  });

  assert.deepEqual(
    fake.paths.filter((url) => url.endsWith("/source-access")),
    ["/v2/paywalls/2080/source-access", "/v2/paywalls/3080/source-access"],
  );
  assert.ok(!fake.calls.includes("versions"));
});

test("--source still pushes the source of an app whose paywall did not change when another app's did", async () => {
  const project = scaffold();
  twoApps(project);
  const fake = await fakeApi(unchanged);

  await runPushPipeline(contextFor(fake.api), {
    promote: false,
    source: true,
    load: async () =>
      declaring(
        project,
        { "plus-upgrade": ["ios", "android"] },
        {
          buildSnapshot: async (_project, _surface, options) =>
            built({ snapshotId: options?.platform === "android" ? "a".repeat(64) : "b".repeat(64) }),
        },
      ),
  });

  assert.deepEqual(
    fake.paths.filter((url) => url.endsWith("/source-access") || url.endsWith("/source-commit")),
    [
      "/v2/paywalls/2080/source-access",
      "/v2/paywalls/2080/versions/7/source-commit",
      "/v2/paywalls/3080/source-access",
    ],
  );
});
