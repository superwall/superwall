import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, mock, test } from "node:test";
import { PLAYBOOKS, readBundledSkill } from "@/core/support/skills";
import { printPlaybook, type Playbook } from "@/core/workflows/playbook";
import { expoApp, iosApp } from "../../helpers/workflow";

const skillsDir = process.env.SUPERWALL_AGENT_SKILLS_DIR;

afterEach(() => {
  mock.restoreAll();
  process.env.SUPERWALL_AGENT_SKILLS_DIR = skillsDir;
  process.exitCode = undefined;
});

async function printed(installDir: string, playbook: Playbook) {
  let stdout = "";
  let stderr = "";
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  mock.method(process.stdout, "write", (value: string | Uint8Array) => (typeof value === "string" ? ((stdout += value), true) : out(value)));
  mock.method(process.stderr, "write", (value: string | Uint8Array) => (typeof value === "string" ? ((stderr += value), true) : err(value)));
  try {
    await printPlaybook(installDir, playbook);
  } finally {
    mock.restoreAll();
  }
  return { stdout, stderr };
}

test("the review playbook carries the reference for the app's framework", async () => {
  const { stdout } = await printed(iosApp(), "review");
  assert.equal(stdout, `${readBundledSkill("superwall-review", "ios")}\n`);
  const fix = await printed(expoApp(), "review-fix");
  assert.equal(fix.stdout, `${readBundledSkill("superwall-review", "expo")}\n`);
});

test("the integrate playbook joins its three phases for the app's framework", async () => {
  const { stdout } = await printed(expoApp(), "integrate");
  assert.match(stdout, /^# Set up Superwall - full integration\n\nDo all three phases in order:\n\n---\n\n/);
  assert.ok(stdout.includes(readBundledSkill("superwall-integrate", "expo")));
  assert.ok(stdout.includes(readBundledSkill("superwall-placements", ["strategy", "expo"])));
  assert.ok(stdout.endsWith(`${readBundledSkill("superwall-dashboard")}\n`));
});

test("the migrate playbook carries the reference for the provider the app uses", async () => {
  for (const [dependency, reference] of [
    ["react-native-purchases", "revenuecat"],
    ["react-native-adapty", "adapty"],
    ["react-native-qonversion", "qonversion"],
  ] as const) {
    const { stdout } = await printed(expoApp({}, { [dependency]: "1.0.0" }), "migrate");
    assert.equal(stdout, `${readBundledSkill("superwall-migrate", reference)}\n`);
  }
  const none = await printed(expoApp(), "migrate");
  assert.equal(none.stdout, `${readBundledSkill("superwall-migrate")}\n`);
});

test("a folder that can't be scanned still prints the generic playbook", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sw-playbook-")), "not-a-dir");
  fs.writeFileSync(file, "");
  const { stdout } = await printed(file, "migrate");
  assert.equal(stdout, `${readBundledSkill("superwall-migrate")}\n`);
});

function emptyInstalledSkills(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-empty-skills-"));
  for (const { playbook } of Object.values(PLAYBOOKS)) {
    fs.mkdirSync(path.dirname(path.join(dir, playbook)), { recursive: true });
    fs.writeFileSync(path.join(dir, playbook), "");
  }
  fs.writeFileSync(path.join(dir, PLAYBOOKS["superwall-placements"].refs, "strategy.md"), "");
  process.env.SUPERWALL_AGENT_SKILLS_DIR = dir;
}

test("installed skills that are empty print nothing and fail", async () => {
  emptyInstalledSkills();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-playbook-none-"));
  const integrate = await printed(dir, "integrate");
  assert.equal(integrate.stdout, "");
  assert.equal(integrate.stderr, "No bundled skills found for integrate.\n");
  assert.equal(process.exitCode, 1);

  process.exitCode = undefined;
  const review = await printed(dir, "review");
  assert.equal(review.stderr, "No bundled skill found for review.\n");
  assert.equal(process.exitCode, 1);
});
