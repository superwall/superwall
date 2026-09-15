import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { executeCommand } from "@/command";
import { runMigrate } from "@/commands/workflow/migrate";
import { writeOrigin } from "@/core/paywalls/project/lock";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { clearHomes } from "../../helpers/home";

const FIXTURES = path.resolve("tests/fixtures/screens");

afterEach(() => {
  clearHomes();
});

function scratch(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
}

const appWithScreen = (name: string): { root: string; file: string } => {
  const root = scratch(name);
  fs.mkdirSync(path.join(root, "App"), { recursive: true });
  const file = path.join(root, "App", "UpdateRequiredView.swift");
  fs.copyFileSync(path.join(FIXTURES, "UpdateRequiredView.swift"), file);
  return { root, file };
};

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

test("migrate --screen --skill needs the screen scaffolded first, and a path", async () => {
  const { root, file } = appWithScreen("screen-skill-missing");
  const missing = await migrate({ screen: file, installDir: root, skill: true });
  assert.equal(missing.failed, true);
  assert.equal(missing.printed, "");
  assert.match(text(missing.calls, "error"), /once without --skill/);

  const noPath = await migrate({ screen: "", installDir: root, skill: true });
  assert.equal(noPath.failed, true);
  assert.match(text(noPath.calls, "error"), /`--skill` needs the screen/);
});

test("migrate --screen with no path lists the likely screens when nobody can pick", async () => {
  const { root } = appWithScreen("screen-list");
  fs.writeFileSync(path.join(root, "App", "Helpers.swift"), "func helper() {}");
  const { calls, failed } = await migrate({ screen: "", installDir: root });
  assert.equal(failed, false, text(calls, "error"));
  const list = calls.find((call) => call.method === "list")?.value as {
    items: Array<{ label: string; meta?: string }>;
  };
  assert.deepEqual(list.items.map((item) => item.label), ["App/UpdateRequiredView.swift"]);
  assert.match(list.items[0]?.meta ?? "", /update-required/);
  assert.match(text(calls, "info"), /Pass one: `superwall migrate --screen <path>`/);
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
});

test("migrate --screen with no path and nothing screen-like says so", async () => {
  const root = scratch("screen-none");
  fs.writeFileSync(path.join(root, "README.md"), "# nothing");
  const { calls, failed } = await migrate({ screen: "", installDir: root });
  assert.equal(failed, true);
  assert.match(text(calls, "error"), /No screen-like files found under .* — pass one/);
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
