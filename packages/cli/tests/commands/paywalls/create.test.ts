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

test("an app that already has a superwall/ directory is refused", async () => {
  const root = scratch("existing");
  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "package.json"), "{}");
  const { calls, failed } = await create({ dir: root, install: false, connect: false });

  assert.equal(failed, true);
  assert.match(String(calls.find((call) => call.method === "error")?.value), /superwall dev/);
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
