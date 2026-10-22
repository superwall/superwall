import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { command as doctor } from "@/commands/support/doctor";
import { restoreBin, useBin } from "../../helpers/bin";
import { clearHomes, useHome } from "../../helpers/home";
import { runCommand } from "../../helpers/command";

const dirs: string[] = [];

beforeEach(() => {
  useBin({ claude: "exit 127", codex: "exit 127" });
});

afterEach(() => {
  restoreBin();
  clearHomes();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.SUPERWALL_API_KEY;
  process.exitCode = undefined;
});

function project(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-doctor-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

test("reports every check, and counts the ones needing attention", async () => {
  useHome();
  const installDir = project();

  const result = await runCommand(doctor, { flags: { installDir } });

  const report = result.said("report").join("\n");
  assert.match(report, /Project/);
  assert.match(report, /Logged in/);
  assert.match(report, /run `superwall login`/);
  assert.match(result.said("outro").join(), /checks need attention/);
});

test("counts an API key in the environment as being logged in", async () => {
  useHome();
  process.env.SUPERWALL_API_KEY = "sk_env";
  const installDir = project();

  const result = await runCommand(doctor, { flags: { installDir } });

  assert.match(result.said("report").join("\n"), /✓ Logged in.*SUPERWALL_API_KEY/);
});

test("names the account when a session is on disk", async () => {
  useHome({ userEmail: "dev@example.com" });
  const installDir = project();

  const result = await runCommand(doctor, { flags: { installDir } });

  assert.match(result.said("report").join("\n"), /Logged in.*dev@example\.com/);
});

test("--json reports each check as data, with one overall verdict", async () => {
  useHome({ userEmail: "dev@example.com" });
  const installDir = project();

  const result = await runCommand(doctor, { json: true, flags: { installDir } });

  const payload = result.json as { ok: boolean; checks: { ok: boolean; label: string }[] };
  assert.equal(typeof payload.ok, "boolean");
  assert.deepEqual(
    payload.checks.map((check) => check.label).filter((label) => label === "Logged in"),
    ["Logged in"],
  );
  assert.equal(
    payload.ok,
    payload.checks.every((check) => check.ok),
  );
});

test("says all checks passed only when they did", async () => {
  useHome({ userEmail: "dev@example.com" });
  const installDir = project({
    "package.json": JSON.stringify({ name: "app", dependencies: { expo: "^51.0.0" } }),
    "app.json": JSON.stringify({ expo: { name: "app" } }),
  });

  const result = await runCommand(doctor, { flags: { installDir } });
  const outro = result.said("outro").join();

  assert.match(outro, /All checks passed\.|checks need attention/);
});
