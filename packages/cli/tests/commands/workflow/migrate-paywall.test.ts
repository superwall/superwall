import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { executeCommand } from "@/command";
import { runMigrate } from "@/commands/workflow/migrate";
import { writeOrigin } from "@/core/paywalls/project/lock";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
});

function scratch(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
}

async function migrate(argv: Record<string, unknown>, calls: RendererCall[] = []) {
  const before = process.exitCode;
  let printed = "";
  const write = process.stdout.write.bind(process.stdout);
  if (argv.skill) {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      printed += String(chunk);
      return true;
    }) as typeof process.stdout.write;
  }
  try {
    await executeCommand(runMigrate.definition, { _: [], $0: "superwall", ...argv }, {
      renderer: () => recordingRenderer(calls),
      nonInteractive: true,
      waitForPaint: false,
    });
  } finally {
    process.stdout.write = write;
  }
  const failed =
    process.exitCode !== undefined && process.exitCode !== 0 && process.exitCode !== before;
  process.exitCode = before;
  return { calls, failed, printed };
}

const scaffoldProject = (dir: string) => {
  fs.mkdirSync(path.join(dir, "paywalls", "force-update"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { superwall: "latest" } }));
  fs.writeFileSync(path.join(dir, "paywalls", "force-update", "MIGRATION.md"), "# brief\n- Pages: 1\n");
  writeOrigin(dir, "paywall", "force-update", {
    paywallId: "255456",
    url: "https://runtime.example/store/document/abc",
  });
};

const originRow = {
  id: 255456,
  application_id: "43674",
  project_id: "21525",
  application_platform: "ios",
  name: "Force Update",
  paywall_url: "https://runtime.example/store/document/abc",
  presentation_style: "fullscreen",
  headless: false,
  products: [],
  feature_gating: "non_gated",
};

test("migrate <id> picks up a paywall already scaffolded under superwall/ and leaves the next steps", async () => {
  const root = scratch("migrate-existing");
  scaffoldProject(path.join(root, "superwall"));

  const { calls, failed } = await migrate({ paywall: "255456", installDir: root });
  assert.equal(failed, false);
  const info = calls
    .filter((call) => call.method === "info")
    .map((call) => String(call.value))
    .join();
  assert.match(info, /was scaffolded from paywall 255456/);
  assert.equal(calls.some((call) => call.method === "spinner.start"), false);
  assert.equal(calls.some((call) => call.method === "confirm"), false);
});

test("migrate <id> --skill prints the prompt and nothing else", async () => {
  const root = scratch("migrate-skill");
  scaffoldProject(root);

  const { calls, failed, printed } = await migrate({ paywall: 255456, installDir: root, skill: true });
  assert.equal(failed, false);
  assert.match(printed, /^<context>/);
  assert.match(printed, /paywalls\/force-update\/MIGRATION\.md/);
  assert.doesNotMatch(printed, /\[STATUS\]/);
  assert.equal(calls.some((call) => call.method === "intro"), false);
});

test("migrate <id> --skill needs the paywall scaffolded first", async () => {
  const root = scratch("migrate-skill-missing");
  const { calls, failed, printed } = await migrate({ paywall: "1", installDir: root, skill: true });
  assert.equal(failed, true);
  assert.equal(printed, "");
  assert.match(String(calls.find((call) => call.method === "error")?.value), /once without --skill/);
});

test("migrate <id> scaffolds into an existing bare project without touching its package.json", async () => {
  const root = scratch("migrate-into-bare");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "mine", dependencies: { superwall: "latest" } }),
  );
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: originRow },
    {
      match: "/v2/projects",
      body: {
        data: [{ id: 21525, name: "P", applications: [{ id: 43674, name: "Force", platform: "ios" }] }],
        has_more: false,
      },
    },
  ]);

  const { calls, failed } = await migrate({ paywall: "255456", installDir: root });
  assert.equal(failed, false);
  assert.ok(fs.existsSync(path.join(root, "paywalls", "force-update", "config.ts")));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name,
    "mine",
  );
  const step = calls
    .filter((call) => call.method === "step")
    .map((call) => String(call.value))
    .join();
  assert.match(step, /Created \.\/paywalls\/force-update/);
  const lock = JSON.parse(fs.readFileSync(path.join(root, "superwall.lock"), "utf8")) as {
    apps: Record<string, string>;
    origins: Record<string, unknown>;
  };
  assert.deepEqual(lock.apps, { ios: "43674" });
  assert.ok(lock.origins["paywall/force-update"]);
});

test("migrate <id> scaffolds a new superwall/ in an app, but not over some other package", async () => {
  const root = scratch("migrate-new");
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: originRow },
    { match: "/v2/projects", body: { data: [], has_more: false } },
  ]);

  const fresh = await migrate({ paywall: "255456", installDir: root });
  assert.equal(fresh.failed, false);
  assert.ok(fs.existsSync(path.join(root, "superwall", "package.json")));
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "force-update", "MIGRATION.md")));

  const foreign = scratch("migrate-foreign");
  fs.mkdirSync(path.join(foreign, "superwall"));
  fs.writeFileSync(path.join(foreign, "superwall", "package.json"), "{}");
  const refused = await migrate({ paywall: "255456", installDir: foreign });
  assert.equal(refused.failed, true);
  assert.match(String(refused.calls.find((call) => call.method === "error")?.value), /isn't a superwall project/);
});

test("migrate <id> refuses a paywall with no served document, since there is nothing to compare against", async () => {
  const root = scratch("migrate-nodoc");
  useHome({ apiKey: "sk_live_x", orgId: "1" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: { ...originRow, paywall_url: null } },
    { match: "/v2/projects", body: { data: [], has_more: false } },
  ]);
  const { calls, failed } = await migrate({ paywall: "255456", installDir: root });
  assert.equal(failed, true);
  assert.match(String(calls.find((call) => call.method === "error")?.value), /no served document/);
});

test("migrate without a paywall id is still the provider migration", async () => {
  const root = scratch("migrate-provider");
  const { calls, failed } = await migrate({ installDir: root });
  assert.equal(failed, true);
  assert.match(String(calls.find((call) => call.method === "error")?.value), /No coding agent|No iOS/);
});
