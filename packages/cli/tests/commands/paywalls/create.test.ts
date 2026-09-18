import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { executeCommand } from "@/command";
import { alreadyAProject, runCreate } from "@/commands/paywalls/create";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { exampleTarball } from "../../helpers/tarball";

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
});

function scratch(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
}

async function create(argv: Record<string, unknown>, calls: RendererCall[] = []) {
  const before = process.exitCode;
  await executeCommand(runCreate.definition, { _: [], $0: "superwall", ...argv }, {
    renderer: () => recordingRenderer(calls),
    nonInteractive: true,
    waitForPaint: false,
  });
  const failed =
    process.exitCode !== undefined && process.exitCode !== 0 && process.exitCode !== before;
  process.exitCode = before;
  return { calls, failed };
}

test("create scaffolds superwall/ inside the app root, named after the app", async () => {
  const root = path.join(scratch("create"), "my-app");
  fs.mkdirSync(root);
  const { calls, failed } = await create({ dir: root, install: false, connect: false });

  assert.equal(failed, false);
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "pro", "config.ts")));
  const parsed = JSON.parse(
    fs.readFileSync(path.join(root, "superwall", "package.json"), "utf8"),
  );
  assert.equal(parsed.name, "my-app");
  const list = calls.find((call) => call.method === "list");
  const labels = (list?.value as { items: Array<{ label: string }> }).items.map(
    (item) => item.label,
  );
  assert.match(labels[0] ?? "", /^cd superwall && /);
  assert.ok(labels.some((label) => label === "superwall integrate"));
});

test("an app that already has a superwall/ project gets a paywall added, not a second project", async () => {
  const root = scratch("existing");
  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "superwall.lock"), "{}");
  const { calls, failed } = await create({ dir: root, install: false, connect: false });

  assert.equal(failed, false);
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "pro", "config.ts")));
  assert.equal(fs.existsSync(path.join(root, "superwall", "package.json")), false);
  assert.equal(calls.some((call) => call.method === "error"), false);
});

test("a superwall/ directory holding some other package is refused, not overwritten", () => {
  const root = scratch("foreign");
  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "package.json"), "{}");
  assert.match(alreadyAProject(root) ?? "", /isn't a superwall project/);
});

test("a superwall/ directory with only leftover subdirectories does not block setup", () => {
  const root = scratch("leftover");
  fs.mkdirSync(path.join(root, "superwall", "paywalls"), { recursive: true });
  assert.equal(alreadyAProject(root), undefined);
});

test("a bare superwall project root is recognized by its markers", () => {
  const bare = scratch("bare");
  fs.writeFileSync(path.join(bare, "superwall.lock"), "{}");
  assert.match(alreadyAProject(bare) ?? "", /already a superwall project/);

  const byDep = scratch("dep");
  fs.writeFileSync(
    path.join(byDep, "package.json"),
    JSON.stringify({ dependencies: { superwall: "latest" } }),
  );
  assert.match(alreadyAProject(byDep) ?? "", /already a superwall project/);
});

test("an empty superwall/ directory does not block setup", () => {
  const root = scratch("fresh");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.mkdirSync(path.join(root, "superwall"));

  assert.equal(alreadyAProject(root), undefined);
});

test("an example is downloaded, adopted, and named after the app", async () => {
  const root = path.join(scratch("create-example"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  const tarball = exampleTarball("apple-pay");
  globalThis.fetch = (async () =>
    new Response(tarball, {
      status: 200,
      headers: { "content-type": "application/gzip" },
    })) as typeof fetch;

  const { calls, failed } = await create({
    dir: root,
    example: "apple-pay",
    install: false,
    connect: false,
  });

  assert.equal(failed, false);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "superwall", "package.json"), "utf8")) as {
    name: string;
  };
  assert.equal(pkg.name, "my-app");
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "apple-pay", "config.ts")));
  assert.match(
    calls
      .filter((call) => call.method === "spinner.stop")
      .map((call) => String(call.value))
      .join(),
    /from the `apple-pay` example/,
  );
});

test("a failed download leaves no half-written superwall/ behind", async () => {
  const root = path.join(scratch("create-fail"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;

  const { failed } = await create({ dir: root, example: "ghost", install: false, connect: false });

  assert.equal(failed, true);
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
});

const originRow = {
  id: 255456,
  application_id: "43674",
  project_id: "21525",
  application_platform: "ios",
  name: "Force Update",
  identifier: "force-update-1234-2025-06-01",
  paywall_url: "https://runtime.example/store/document/abc",
  presentation_style: "modal",
  status: "active",
  version: 3,
  headless: false,
  products: [{ store: "app-store", identifier: "com.app.pro.year", reference_name: "primary" }],
  feature_gating: "gated",
  preview_url: "https://shots.example/abc.png",
};

const originDocument = `<html><body><style>html { background-color: #101010ff }</style><script id="vike_pageContext" type="application/json">${JSON.stringify(
  {
    document: {
      schema: {},
      store: {
        "paywall:paywall": { typeName: "paywall", presentationStyleV3: { type: "MODAL" }, isScrollEnabled: "DISABLED" },
        "node:root": { typeName: "node", type: "stack", id: "node:root" },
        "node:cta": {
          typeName: "node",
          type: "stack",
          id: "node:cta",
          parentId: "node:root",
          properties: [{ type: "property-click-behavior", action: { type: "close" } }],
        },
      },
    },
  },
)}</script></body></html>`;

test("--from rebuilds a dashboard paywall's config, briefs the migration, and binds its app", async () => {
  const root = path.join(scratch("create-from"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: originRow },
    { match: "runtime.example/store/document/abc", text: originDocument },
    {
      match: "/v2/projects",
      body: {
        data: [
          { id: 21525, name: "P", applications: [{ id: 43674, name: "Force", platform: "ios" }] },
        ],
        has_more: false,
      },
    },
  ]);

  const { calls, failed } = await create({ dir: root, from: "255456", install: false });

  assert.equal(failed, false);
  const surface = path.join(root, "superwall", "paywalls", "force-update");
  const config = fs.readFileSync(path.join(surface, "config.ts"), "utf8");
  assert.match(config, /name: "Force Update"/);
  assert.match(config, /platforms: \["ios"\]/);
  assert.match(config, /primary: "com\.app\.pro\.year"/);
  assert.match(config, /presentation: \{ style: "modal" \}/);
  assert.match(config, /background: "#101010"/);
  assert.match(config, /featureGating: "gated"/);
  assert.match(config, /scrollEnabled: false/);
  assert.ok(fs.existsSync(path.join(surface, "app", "index.tsx")));
  const brief = fs.readFileSync(path.join(surface, "MIGRATION.md"), "utf8");
  assert.match(brief, /Dashboard paywall: 255456/);
  assert.match(brief, /close ×1/);
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "superwall", "superwall.lock"), "utf8"),
  ) as { apps: Record<string, string>; origins: Record<string, unknown> };
  assert.deepEqual(lock.apps, { ios: "43674" });
  assert.deepEqual(lock.origins, {
    "paywall/force-update": {
      paywallId: "255456",
      url: "https://runtime.example/store/document/abc",
    },
  });
  const said = (method: string) =>
    calls
      .filter((call) => call.method === method)
      .map((call) => String(call.value))
      .join();
  assert.match(said("success"), /Pushes go to `Force`, the paywall's app/);
  assert.equal(calls.some((call) => call.method === "confirm"), false);
  const list = calls.find((call) => call.method === "list");
  const labels = (list?.value as { items: Array<{ label: string }> }).items.map(
    (item) => item.label,
  );
  assert.match(labels[0] ?? "", /^superwall migrate 255456 — rebuild with your agent/);
  assert.match(labels[1] ?? "", /superwall dev` in superwall/);
  assert.match(labels[2] ?? "", /ask your agent to tweak/);
});

test("--from binds the paywall's app even when the CLI's organization cannot see it, and says so", async () => {
  const root = path.join(scratch("create-from-org"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: { ...originRow, products: [], paywall_url: null } },
    { match: "/v2/projects/21525", body: { id: 21525, organization_id: 10566 } },
    { match: "/v2/projects", body: { data: [], has_more: false } },
  ]);

  const { calls, failed } = await create({ dir: root, from: "255456", install: false });

  assert.equal(failed, false);
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "superwall", "superwall.lock"), "utf8"),
  ) as { apps: Record<string, string>; origins?: unknown };
  assert.deepEqual(lock.apps, { ios: "43674" });
  assert.equal(lock.origins, undefined);
  const said = (method: string) =>
    calls
      .filter((call) => call.method === method)
      .map((call) => String(call.value))
      .join();
  assert.match(said("success"), /Pushes go to app 43674/);
  assert.match(said("warn"), /superwall orgs use 10566/);
  const brief = fs.readFileSync(
    path.join(root, "superwall", "paywalls", "force-update", "MIGRATION.md"),
    "utf8",
  );
  assert.match(brief, /could not be read/);
});

test("--from still names the org switch when the project's organization cannot be read", async () => {
  const root = path.join(scratch("create-from-noorg"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: { ...originRow, products: [], paywall_url: null } },
    { match: "/v2/projects/21525", status: 404, body: { error: "nope" } },
    { match: "/v2/projects", body: { data: [], has_more: false } },
  ]);

  const { calls, failed } = await create({ dir: root, from: "255456", install: false });
  assert.equal(failed, false);
  const warned = calls
    .filter((call) => call.method === "warn")
    .map((call) => String(call.value))
    .join();
  assert.match(warned, /superwall orgs use <id>/);
});

test("--from explains a paywall the account cannot see", async () => {
  const root = path.join(scratch("create-from-hidden"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    {
      match: "/v2/paywalls/424242",
      status: 404,
      body: { error: { message: "No such paywall: '424242'" } },
    },
  ]);

  const { calls, failed } = await create({ dir: root, from: "424242", install: false });
  assert.equal(failed, true);
  assert.match(
    String(calls.find((call) => call.method === "error")?.value),
    /isn't visible to this account[\s\S]*superwall orgs use/,
  );
  assert.equal(fs.existsSync(path.join(root, "superwall", "package.json")), false);
});

test("--from reads a real multi-page document, warns about template products, and names an app without a name by id", async () => {
  const root = path.join(scratch("create-from-real"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    {
      match: "/v2/paywalls/65920",
      body: {
        ...originRow,
        id: 65920,
        name: "Increase your revenue",
        products: [{ store: "app-store", identifier: "missing", reference_name: "offer" }],
      },
    },
    {
      match: "runtime.example/store/document/abc",
      text: fs.readFileSync(
        path.join("tests", "fixtures", "origin", "multi-page-template.html"),
        "utf8",
      ),
    },
    {
      match: "/v2/projects",
      body: {
        data: [{ id: 21525, name: "P", applications: [{ id: 43674, platform: "ios" }] }],
        has_more: false,
      },
    },
  ]);

  const { calls, failed } = await create({ dir: root, from: "65920", install: false });
  assert.equal(failed, false);
  const said = (method: string) =>
    calls
      .filter((call) => call.method === method)
      .map((call) => String(call.value))
      .join("\n");
  assert.match(said("spinner.stop"), /1 products, 4 pages/);
  assert.match(said("warn"), /Some product slots have no store product/);
  assert.match(said("success"), /Pushes go to `43674`, the paywall's app/);
  const brief = fs.readFileSync(
    path.join(root, "superwall", "paywalls", "increase-your-revenue", "MIGRATION.md"),
    "utf8",
  );
  assert.match(brief, /Pages: 4/);
});

test("--from falls back to the API row when the served document cannot be fetched, and to `<id>` without a project", async () => {
  const root = path.join(scratch("create-from-nodoc"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: { ...originRow, project_id: null } },
    { match: "runtime.example/store/document/abc", status: 500, text: "nope" },
    { match: "/v2/projects", body: { data: [], has_more: false } },
  ]);

  const { calls, failed } = await create({ dir: root, from: "255456", install: false });
  assert.equal(failed, false);
  const said = (method: string) =>
    calls
      .filter((call) => call.method === method)
      .map((call) => String(call.value))
      .join("\n");
  assert.match(said("spinner.stop"), /from the API only/);
  assert.match(said("warn"), /superwall orgs use <id>/);
  const brief = fs.readFileSync(
    path.join(root, "superwall", "paywalls", "force-update", "MIGRATION.md"),
    "utf8",
  );
  assert.match(brief, /could not be read/);
});

test("--from surfaces a network failure as itself, and names an unnamed headless paywall by id", async () => {
  const offline = path.join(scratch("create-from-offline"), "my-app");
  fs.mkdirSync(offline, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([{ match: "/v2/paywalls/255456", fail: true }]);
  const down = await create({ dir: offline, from: "255456", install: false });
  assert.equal(down.failed, true);
  assert.doesNotMatch(String(down.calls.find((call) => call.method === "error")?.value), /isn't visible/);

  const nameless = path.join(scratch("create-from-nameless"), "my-app");
  fs.mkdirSync(nameless, { recursive: true });
  useFetch([{ match: "/v2/paywalls/900", body: { ...originRow, id: 900, name: null, headless: true } }]);
  const headless = await create({ dir: nameless, from: "900", install: false });
  assert.equal(headless.failed, true);
  assert.match(
    headless.calls
      .filter((call) => call.method === "spinner.stop")
      .map((call) => String(call.value))
      .join(),
    /`900` is already code/,
  );
});

test("inside an existing project, create adds a starter paywall with a unique id and touches nothing else", async () => {
  const root = scratch("create-add");
  const project = path.join(root, "superwall");
  fs.mkdirSync(path.join(project, "paywalls", "pro"), { recursive: true });
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "mine", dependencies: { superwall: "latest" } }),
  );
  const { calls, failed } = await create({ dir: root, install: false });
  assert.equal(failed, false);
  assert.ok(fs.existsSync(path.join(project, "paywalls", "pro-2", "config.ts")));
  assert.ok(fs.existsSync(path.join(project, "paywalls", "pro-2", "messages", "en.ts")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")).name, "mine");
  assert.match(
    calls
      .filter((call) => call.method === "step")
      .map((call) => String(call.value))
      .join(),
    /Created .*paywalls\/pro-2 from the minimal template/,
  );
});

test("inside an existing project, --from adds the rebuilt paywall to it", async () => {
  const root = scratch("create-add-from");
  const project = path.join(root, "superwall");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "mine", dependencies: { superwall: "latest" } }),
  );
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: originRow },
    { match: "runtime.example/store/document/abc", text: originDocument },
    {
      match: "/v2/projects",
      body: {
        data: [{ id: 21525, name: "P", applications: [{ id: 43674, name: "Force", platform: "ios" }] }],
        has_more: false,
      },
    },
  ]);
  const { calls, failed } = await create({ dir: root, from: "255456", install: false });
  assert.equal(failed, false);
  assert.ok(fs.existsSync(path.join(project, "paywalls", "force-update", "MIGRATION.md")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")).name, "mine");
  const lock = JSON.parse(fs.readFileSync(path.join(project, "superwall.lock"), "utf8")) as {
    origins: Record<string, unknown>;
  };
  assert.ok(lock.origins["paywall/force-update"]);
  const list = calls.find((call) => call.method === "list")?.value as {
    items: Array<{ label: string }>;
  };
  assert.match(list.items[0]?.label ?? "", /^superwall migrate 255456/);
});

test("inside an existing project, an example or --app is refused with a reason", async () => {
  const root = scratch("create-add-refuse");
  fs.mkdirSync(path.join(root, "superwall"), { recursive: true });
  fs.writeFileSync(path.join(root, "superwall", "superwall.lock"), "{}");
  const example = await create({ dir: root, example: "minimal", install: false });
  assert.equal(example.failed, true);
  assert.match(String(example.calls.find((call) => call.method === "error")?.value), /empty directory/);
  const app = await create({ dir: root, app: "42", install: false });
  assert.equal(app.failed, true);
  assert.match(String(app.calls.find((call) => call.method === "error")?.value), /drop `--app`/);
});

test("--from refuses a paywall that is already code, and the flags that contradict it", async () => {
  const root = path.join(scratch("create-from-headless"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([{ match: "/v2/paywalls/900", body: { ...originRow, id: 900, headless: true } }]);

  const headless = await create({ dir: root, from: "900", install: false });
  assert.equal(headless.failed, true);
  assert.match(
    String(headless.calls.find((call) => call.method === "error")?.value),
    /already/,
  );

  const withExample = await create({
    dir: path.join(scratch("create-from-example"), "my-app"),
    from: "900",
    example: "minimal",
    install: false,
  });
  assert.equal(withExample.failed, true);
  const noConnect = await create({
    dir: path.join(scratch("create-from-noconnect"), "my-app"),
    from: "900",
    connect: false,
    install: false,
  });
  assert.equal(noConnect.failed, true);
});

test("connecting binds the account's only app into superwall.lock", async () => {
  const root = path.join(scratch("create-connect"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    {
      match: "/v2/projects",
      body: {
        data: [{ id: 9, name: "P", applications: [{ id: 42, name: "My App", platform: "ios" }] }],
        has_more: false,
      },
    },
  ]);

  const { calls, failed } = await create({ dir: root, install: false });

  assert.equal(failed, false);
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "superwall", "superwall.lock"), "utf8"),
  ) as { apps: Record<string, string> };
  assert.deepEqual(lock.apps, { ios: "42" });
  assert.match(
    calls
      .filter((call) => call.method === "success")
      .map((call) => String(call.value))
      .join(),
    /Pushes go to `My App`/,
  );
});

test("several apps and nobody to ask leaves the choice to the first push", async () => {
  const root = path.join(scratch("create-many"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    {
      match: "/v2/projects",
      body: {
        data: [
          {
            id: 9,
            name: "P",
            applications: [
              { id: 1, name: "A", platform: "ios" },
              { id: 2, name: "B", platform: "android" },
            ],
          },
        ],
        has_more: false,
      },
    },
  ]);

  const { calls, failed } = await create({ dir: root, install: false });

  assert.equal(failed, false);
  assert.equal(fs.existsSync(path.join(root, "superwall", "superwall.lock")), false);
  assert.match(
    calls
      .filter((call) => call.method === "info")
      .map((call) => String(call.value))
      .join(),
    /first `superwall push` will ask which one/,
  );
});

const twoApps = {
  match: "/v2/projects",
  body: {
    data: [
      {
        id: 9,
        name: "P",
        applications: [
          { id: 1, name: "A", platform: "ios" },
          { id: 2, name: "B", platform: "android" },
        ],
      },
    ],
    has_more: false,
  },
};

test("--app binds the named app without asking, even among several", async () => {
  const root = path.join(scratch("create-app"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([twoApps]);

  const { calls, failed } = await create({ dir: root, install: false, app: "2" });

  assert.equal(failed, false);
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "superwall", "superwall.lock"), "utf8"),
  ) as { apps: Record<string, string> };
  assert.deepEqual(lock.apps, { android: "2" });
  assert.match(
    calls
      .filter((call) => call.method === "success")
      .map((call) => String(call.value))
      .join(),
    /Pushes go to `B`/,
  );
});

test("--app with an id the account does not have fails loudly", async () => {
  const root = path.join(scratch("create-app-missing"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([twoApps]);

  const { calls, failed } = await create({ dir: root, install: false, app: "77" });

  assert.equal(failed, true);
  assert.match(
    String(calls.find((call) => call.method === "error")?.value),
    /No app with id `77`.*superwall apps/,
  );
});

test("--app is refused alongside --no-connect", async () => {
  const root = path.join(scratch("create-app-noconnect"), "my-app");
  fs.mkdirSync(root, { recursive: true });

  const { calls, failed } = await create({ dir: root, install: false, connect: false, app: "2" });

  assert.equal(failed, true);
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
  assert.match(String(calls.find((call) => call.method === "error")?.value), /--no-connect/);
});

test("--app while signed out fails instead of deferring to push", async () => {
  const root = path.join(scratch("create-app-anon"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome();

  const { calls, failed } = await create({ dir: root, install: false, app: "2" });

  assert.equal(failed, true);
  assert.ok(calls.some((call) => call.method === "error"));
});

test("not being signed in never fails the scaffold", async () => {
  const root = path.join(scratch("create-anon"), "my-app");
  fs.mkdirSync(root, { recursive: true });
  useHome();

  const { calls, failed } = await create({ dir: root, install: false });

  assert.equal(failed, false);
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "pro", "config.ts")));
  assert.match(
    calls
      .filter((call) => call.method === "info")
      .map((call) => String(call.value))
      .join(),
    /Not signed in/,
  );
});
