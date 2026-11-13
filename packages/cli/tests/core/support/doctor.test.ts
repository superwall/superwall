import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { detectDrivers } from "@/core/workflows/agent/drivers/index";
import { runDoctor } from "@/core/support/doctor";
import { writeUpdateCheck } from "@/core/state/config";
import { VERSION } from "@/environment";
import { defineCommand } from "@/program/command";
import { installDir } from "@/program/flags";
import { clearHomes, useHome } from "../../helpers/home";
import { runCommand } from "../../helpers/command";

const dirs: string[] = [];
const envKey = process.env.SUPERWALL_API_KEY;

afterEach(() => {
  clearHomes();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (envKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = envKey;
  process.exitCode = undefined;
});

function project(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-doctor-core-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

function agents(...names: string[]): typeof detectDrivers {
  return async () =>
    names.map((displayName) => ({ info: { displayName } })) as unknown as Awaited<ReturnType<typeof detectDrivers>>;
}

const doctorWith = (found: typeof detectDrivers) =>
  defineCommand({
    name: "doctor",
    summary: "Doctor probe",
    flags: { installDir },
    examples: [["doctor", "Probe"]],
    auth: "optional",
    json: true,
    prompts: true,
    mcp: "read",
    run(ctx) {
      return runDoctor(ctx, { detectDrivers: found });
    },
  });

const CLI_ROW = `✓ CLI           ${VERSION}`;

const expoApp = {
  "package.json": JSON.stringify({ name: "app", dependencies: { expo: "^51.0.0", "expo-superwall": "^1.0.0" } }),
  "App.tsx": 'export default () => <SuperwallProvider apiKeys={{ ios: "pk_live_abcdef123" }} />;',
};

test("an empty folder with no agent and no login fails every check", async () => {
  useHome();
  delete process.env.SUPERWALL_API_KEY;
  const result = await runCommand(doctorWith(agents()), { flags: { installDir: project() } });
  assert.deepEqual(result.said("intro"), ["Superwall doctor"]);
  assert.deepEqual(result.said("report"), [
    [
      CLI_ROW,
      "✗ Coding agent  none found",
      "✗ Project       not detected",
      "✗ Logged in     no - run `superwall login`",
    ].join("\n"),
  ]);
  assert.deepEqual(result.said("outro"), ["3 of 4 checks need attention."]);
});

test("a fully integrated Expo app with an agent and a session passes every check", async () => {
  useHome({ userEmail: "dev@example.com" });
  const result = await runCommand(doctorWith(agents("Claude Code", "Codex")), {
    flags: { installDir: project(expoApp) },
  });
  assert.deepEqual(result.said("report"), [
    [
      CLI_ROW,
      "✓ Coding agent  Claude Code, Codex",
      "✓ Project       Expo (React Native) · Expo ^51.0.0",
      "✓ SDK           installed",
      "✓ configure()   present",
      "✓ API key       pk_live_abcdef123",
      "✓ Logged in     dev@example.com",
    ].join("\n"),
  ]);
  assert.deepEqual(result.said("outro"), ["All checks passed."]);
});

test("an app without the SDK reports what is missing", async () => {
  useHome({ orgName: "Acme" });
  const result = await runCommand(doctorWith(agents("Codex")), {
    flags: { installDir: project({ "pubspec.yaml": "name: app\n" }) },
  });
  assert.deepEqual(result.said("report"), [
    [
      CLI_ROW,
      "✓ Coding agent  Codex",
      "✓ Project       Flutter",
      "✗ SDK           not installed",
      "✗ configure()   missing",
      "✗ API key       none in project",
      "✓ Logged in     Acme",
    ].join("\n"),
  ]);
  assert.deepEqual(result.said("outro"), ["3 of 7 checks need attention."]);
});

test("a web app is named as unsupported, and a session without names still counts", async () => {
  useHome({});
  const result = await runCommand(doctorWith(agents("Codex")), {
    flags: { installDir: project({ "package.json": JSON.stringify({ name: "site", dependencies: { next: "15" } }) }) },
  });
  assert.deepEqual(result.said("report"), [
    [
      CLI_ROW,
      "✓ Coding agent  Codex",
      "✗ Project       Web (not supported by this command)",
      "✓ Logged in     yes",
    ].join("\n"),
  ]);
});

test("--json reports each check and one verdict, counting an API key in the environment as logged in", async () => {
  useHome();
  process.env.SUPERWALL_API_KEY = "sk_env";
  const result = await runCommand(doctorWith(agents("Codex")), { json: true, flags: { installDir: project() } });
  assert.deepEqual(result.json, {
    ok: false,
    checks: [
      { ok: true, label: "CLI", value: VERSION },
      { ok: true, label: "Coding agent", value: "Codex" },
      { ok: false, label: "Project", value: "not detected" },
      { ok: true, label: "Logged in", value: "via SUPERWALL_API_KEY" },
    ],
  });
});

const pinnedSuperwall = (version: string | undefined, files: Record<string, string> = {}) =>
  project({
    "superwall/package.json": JSON.stringify({ name: "paywalls", dependencies: { superwall: "2.0.0" } }),
    "superwall/node_modules/superwall/package.json": JSON.stringify({ name: "superwall", version }),
    ...files,
  });

async function cliCheck(installDir: string): Promise<unknown> {
  const result = await runCommand(doctorWith(agents("Codex")), { json: true, flags: { installDir } });
  const checks = (result.json as { checks: Array<{ label: string }> }).checks;
  return checks.find((check) => check.label === "CLI");
}

test("a newer release in the update cache fails the CLI row and points at superwall upgrade", async () => {
  useHome();
  writeUpdateCheck({ latest: "999.0.0", checkedAt: new Date().toISOString() });
  assert.deepEqual(await cliCheck(project()), {
    ok: false,
    label: "CLI",
    value: `${VERSION}, 999.0.0 available - run \`superwall upgrade\``,
  });
});

test("an older superwall pinned by the project is the version doctor reports, with its own update command", async () => {
  useHome();
  writeUpdateCheck({ latest: "999.0.0", checkedAt: new Date().toISOString() });
  const installDir = pinnedSuperwall("2.0.0", { "superwall/pnpm-lock.yaml": "" });
  assert.deepEqual(await cliCheck(installDir), {
    ok: false,
    label: "CLI",
    value: `2.0.0 from ${path.join("superwall", "package.json")}, 999.0.0 available - run \`cd superwall && pnpm add superwall@latest\``,
  });
});

test("a current project pin passes, naming the package.json it comes from", async () => {
  useHome();
  writeUpdateCheck({ latest: "2.0.0", checkedAt: new Date().toISOString() });
  assert.deepEqual(await cliCheck(pinnedSuperwall("2.0.0")), {
    ok: true,
    label: "CLI",
    value: `2.0.0 from ${path.join("superwall", "package.json")}`,
  });
});

test("a project pin whose version can't be read fails rather than passing", async () => {
  useHome();
  assert.deepEqual(await cliCheck(pinnedSuperwall(undefined)), {
    ok: false,
    label: "CLI",
    value: `unknown version from ${path.join("superwall", "package.json")} - run \`cd superwall && npm i superwall@latest\``,
  });
});

test("a pin hoisted to the repo root names the workspace that declares it, with the root's package manager", async () => {
  useHome();
  writeUpdateCheck({ latest: "999.0.0", checkedAt: new Date().toISOString() });
  const installDir = project({
    "package.json": JSON.stringify({ name: "app", workspaces: ["superwall"] }),
    "bun.lock": "",
    "superwall/package.json": JSON.stringify({ name: "paywalls", dependencies: { superwall: "2.0.0" } }),
    "node_modules/superwall/package.json": JSON.stringify({ name: "superwall", version: "2.0.0" }),
  });
  assert.deepEqual(await cliCheck(installDir), {
    ok: false,
    label: "CLI",
    value: `2.0.0 from ${path.join("superwall", "package.json")}, 999.0.0 available - run \`cd superwall && bun add superwall@latest\``,
  });
});

test("a hoisted pin only the root declares names the root's package.json", async () => {
  useHome();
  writeUpdateCheck({ latest: "999.0.0", checkedAt: new Date().toISOString() });
  const installDir = project({
    "package.json": JSON.stringify({ name: "app", devDependencies: { superwall: "2.0.0" } }),
    "package-lock.json": "",
    "superwall/package.json": JSON.stringify({ name: "paywalls" }),
    "node_modules/superwall/package.json": JSON.stringify({ name: "superwall", version: "2.0.0" }),
  });
  assert.deepEqual(await cliCheck(installDir), {
    ok: false,
    label: "CLI",
    value: "2.0.0 from package.json, 999.0.0 available - run `npm i superwall@latest`",
  });
});
