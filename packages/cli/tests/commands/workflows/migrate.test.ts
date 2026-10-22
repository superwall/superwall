import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command } from "@/commands/workflows/migrate";
import { readBundledSkill } from "@/core/support/skills";
import { writeOrigin } from "@/core/paywalls/project/lock";
import { runCommand } from "../../helpers/command";
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

async function migrate(
  { paywall, ...flags }: Record<string, unknown>,
  calls: RendererCall[] = [],
) {
  const before = process.exitCode;
  let printed = "";
  const write = process.stdout.write.bind(process.stdout);
  if (flags.skill) {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      if (typeof chunk !== "string") return write(chunk);
      printed += chunk;
      return true;
    }) as typeof process.stdout.write;
  }
  try {
    await runCommand(command, { args: { paywall }, flags, renderer: recordingRenderer(calls) });
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
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { superwall: "latest" } }),
  );
  fs.writeFileSync(
    path.join(dir, "paywalls", "force-update", "MIGRATION.md"),
    "# brief\n- Pages: 1\n",
  );
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
  assert.equal(
    calls.some((call) => call.method === "spinner.start"),
    false,
  );
  assert.equal(
    calls.some((call) => call.method === "confirm"),
    false,
  );
});

test("migrate <id> --skill prints the prompt and nothing else", async () => {
  const root = scratch("migrate-skill");
  scaffoldProject(root);

  const { calls, failed, printed } = await migrate({
    paywall: 255456,
    installDir: root,
    skill: true,
  });
  assert.equal(failed, false);
  assert.match(printed, /^<context>/);
  assert.match(printed, /paywalls\/force-update\/MIGRATION\.md/);
  assert.doesNotMatch(printed, /\[STATUS\]/);
  assert.equal(
    calls.some((call) => call.method === "intro"),
    false,
  );
});

test("migrate <id> --skill needs the paywall scaffolded first", async () => {
  const root = scratch("migrate-skill-missing");
  const { calls, failed, printed } = await migrate({ paywall: "1", installDir: root, skill: true });
  assert.equal(failed, true);
  assert.equal(printed, "");
  assert.match(
    String(calls.find((call) => call.method === "error")?.value),
    /once without --skill/,
  );
});

test("migrate <id> scaffolds into an existing bare project without touching its package.json", async () => {
  const root = scratch("migrate-into-bare");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "mine", dependencies: { superwall: "latest" } }),
  );
  useHome({ apiKey: "sk_live_x" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: originRow },
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

  const { calls, failed } = await migrate({ paywall: "255456", installDir: root });
  assert.equal(failed, false);
  assert.ok(fs.existsSync(path.join(root, "paywalls", "force-update", "config.ts")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name, "mine");
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
  useHome({ apiKey: "sk_live_x" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([
    { match: "/v2/paywalls/255456", body: originRow },
    { match: "/v2/projects", body: { data: [], has_more: false } },
  ]);

  const fresh = await migrate({ paywall: "255456", installDir: root });
  assert.equal(fresh.failed, false);
  assert.ok(fs.existsSync(path.join(root, "superwall", "package.json")));
  assert.ok(
    fs.existsSync(path.join(root, "superwall", "paywalls", "force-update", "MIGRATION.md")),
  );

  const foreign = scratch("migrate-foreign");
  fs.mkdirSync(path.join(foreign, "superwall"));
  fs.writeFileSync(path.join(foreign, "superwall", "package.json"), "{}");
  const refused = await migrate({ paywall: "255456", installDir: foreign });
  assert.equal(refused.failed, true);
  assert.match(
    String(refused.calls.find((call) => call.method === "error")?.value),
    /isn't a superwall project/,
  );
});

test("migrate <id> refuses a paywall with no served document, since there is nothing to compare against", async () => {
  const root = scratch("migrate-nodoc");
  useHome({ apiKey: "sk_live_x" });
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
  const searchPath = process.env.PATH;
  process.env.PATH = scratch("migrate-provider-empty-path");
  try {
    const { calls, failed } = await migrate({ installDir: root });
    assert.equal(failed, true);
    assert.match(
      String(calls.find((call) => call.method === "error")?.value),
      /No iOS \/ Android \/ Expo \/ React Native \/ Flutter app found here/,
    );
  } finally {
    process.env.PATH = searchPath;
  }
});

test("migrate --skill without a paywall id prints the provider migration playbook", async () => {
  const root = scratch("migrate-provider-skill");
  const { calls, failed, printed } = await migrate({ installDir: root, skill: true });
  assert.equal(failed, false);
  assert.ok(printed.endsWith(`${readBundledSkill("superwall-migrate")}\n`));
  assert.match(printed, /# Migrate to Superwall/);
  assert.equal(
    calls.some((call) => call.method === "intro"),
    false,
  );
});

test("migrate <id> never overwrites a surface that already exists under the paywall's slug", async () => {
  const root = scratch("migrate-existing-slug");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "mine", dependencies: { superwall: "latest" } }),
  );
  fs.mkdirSync(path.join(root, "paywalls", "force-update"), { recursive: true });
  fs.writeFileSync(path.join(root, "paywalls", "force-update", "config.ts"), "mine");
  useHome({ apiKey: "sk_live_x" });
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([{ match: "/v2/paywalls/255456", body: originRow }]);

  const { calls, failed } = await migrate({ paywall: "255456", installDir: root });
  assert.equal(failed, true);
  assert.match(
    String(calls.find((call) => call.method === "error")?.value),
    /`paywalls\/force-update` already exists/,
  );
  assert.equal(
    fs.readFileSync(path.join(root, "paywalls", "force-update", "config.ts"), "utf8"),
    "mine",
  );
});

const FIXTURES = path.resolve("tests/fixtures/screens");

afterEach(() => {
  clearHomes();
});

const appWithScreen = (name: string): { root: string; file: string } => {
  const root = scratch(name);
  fs.mkdirSync(path.join(root, "App"), { recursive: true });
  const file = path.join(root, "App", "UpdateRequiredView.swift");
  fs.copyFileSync(path.join(FIXTURES, "UpdateRequiredView.swift"), file);
  return { root, file };
};

const text = (calls: RendererCall[], method: string) =>
  calls.filter((call) => call.method === method).map((call) => String(call.value)).join("\n");

test("migrate --screen <path> scaffolds a new superwall/ project from the screen and leaves the next steps", async () => {
  const { root, file } = appWithScreen("screen-new");
  const { calls, failed } = await migrate({ screen: file, installDir: root });
  assert.equal(failed, false, text(calls, "error"));
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "update-required", "config.ts")));
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "update-required", "MIGRATION.md")));
  assert.match(text(calls, "step"), /Read `\.\.\/App\/UpdateRequiredView.swift` \(SwiftUI\)/);
  assert.equal(calls.some((call) => call.method === "confirm"), false);
  assert.equal(calls.some((call) => call.method === "select"), false);
  const lock = JSON.parse(fs.readFileSync(path.join(root, "superwall", "superwall.lock"), "utf8")) as {
    origins: Record<string, { path: string; framework: string }>;
  };
  assert.deepEqual(lock.origins["paywall/update-required"], {
    path: "../App/UpdateRequiredView.swift",
    framework: "swiftui",
  });
});

test("migrate --screen picks up a screen already scaffolded and does not scaffold again", async () => {
  const { root, file } = appWithScreen("screen-existing");
  const first = await migrate({ screen: file, installDir: root });
  assert.equal(first.failed, false);
  const { calls, failed } = await migrate({ screen: file, installDir: root });
  assert.equal(failed, false, text(calls, "error"));
  assert.match(text(calls, "info"), /`paywalls\/update-required` was scaffolded from `.*UpdateRequiredView.swift` — picking up the rebuild/);
  assert.equal(calls.some((call) => call.method === "step"), false);
});

test("migrate --screen --skill prints the prompt with the framework reference and nothing else", async () => {
  const { root, file } = appWithScreen("screen-skill");
  await migrate({ screen: file, installDir: root });
  const { calls, failed, printed } = await migrate({ screen: file, installDir: root, skill: true });
  assert.equal(failed, false);
  assert.match(printed, /^<context>/);
  assert.match(printed, /source_screen framework="SwiftUI"/);
  assert.match(printed, /iOS source screens/);
  assert.doesNotMatch(printed, /\[STATUS\]/);
  assert.equal(calls.some((call) => call.method === "intro"), false);
});

test("migrate --screen --skill needs the screen scaffolded first", async () => {
  const { root, file } = appWithScreen("screen-skill-missing");
  const missing = await migrate({ screen: file, installDir: root, skill: true });
  assert.equal(missing.failed, true);
  assert.equal(missing.printed, "");
  assert.match(text(missing.calls, "error"), /once without --skill/);
});

test("migrate --screen --screenshot copies the original in, and a missing file is an error", async () => {
  const { root, file } = appWithScreen("screen-shot");
  const shot = path.join(root, "shot.png");
  fs.writeFileSync(shot, "png");
  const { calls, failed } = await migrate({ screen: file, screenshot: shot, installDir: root });
  assert.equal(failed, false, text(calls, "error"));
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "update-required", "original.png")));

  const other = appWithScreen("screen-shot-missing");
  const missing = await migrate({ screen: other.file, screenshot: path.join(other.root, "nope.png"), installDir: other.root });
  assert.equal(missing.failed, true);
  assert.match(text(missing.calls, "error"), /No screenshot at/);
});

test("migrate --screen scaffolds into an existing project at the root, and refuses a foreign package.json", async () => {
  const { root, file } = appWithScreen("screen-into-project");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "mine", dependencies: { superwall: "latest" } }));
  const { calls, failed } = await migrate({ screen: file, installDir: root });
  assert.equal(failed, false, text(calls, "error"));
  assert.ok(fs.existsSync(path.join(root, "paywalls", "update-required", "config.ts")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name, "mine");
  assert.match(text(calls, "step"), /Read `App\/UpdateRequiredView.swift`/);

  const foreign = appWithScreen("screen-foreign");
  fs.mkdirSync(path.join(foreign.root, "superwall"));
  fs.writeFileSync(path.join(foreign.root, "superwall", "package.json"), JSON.stringify({ name: "other" }));
  const refused = await migrate({ screen: foreign.file, installDir: foreign.root });
  assert.equal(refused.failed, true);
  assert.match(text(refused.calls, "error"), /already has a package.json that isn't a superwall project/);
});

test("migrate --screen with a file that is not a screen explains what to pass", async () => {
  const root = scratch("screen-not-a-screen");
  fs.writeFileSync(path.join(root, "Model.swift"), "struct Model {}");
  const { calls, failed } = await migrate({ screen: path.join(root, "Model.swift"), installDir: root });
  assert.equal(failed, true);
  assert.match(text(calls, "error"), /no SwiftUI View or UIViewController/);
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
});

test("a screen origin recorded without its surface is reported, not rebuilt from nothing", async () => {
  const { root, file } = appWithScreen("screen-orphan");
  const target = path.join(root, "superwall");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ dependencies: { superwall: "latest" } }));
  writeOrigin(target, "paywall", "update-required", { path: "../App/UpdateRequiredView.swift", framework: "swiftui" });
  const { calls, failed } = await migrate({ screen: file, installDir: root });
  assert.equal(failed, false, text(calls, "error"));
  assert.match(text(calls, "info"), /picking up the rebuild/);
});
