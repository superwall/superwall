import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { loadBundledSkill } from "@/core/agent/skills";

const original = process.env.SUPERWALL_AGENT_SKILLS_DIR;

afterEach(() => {
  process.env.SUPERWALL_AGENT_SKILLS_DIR = original;
});

test("the installed live copy of a skill wins over the bundle, per playbook", () => {
  const bundled = loadBundledSkill("superwall-dashboard", "setup");
  const live = fs.mkdtempSync(path.join(os.tmpdir(), "sw-live-skills-"));
  fs.mkdirSync(path.join(live, "superwall", "workflows", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(live, "superwall", "workflows", "dashboard", "playbook.md"), "---\nname: superwall\n---\n# LIVE dashboard playbook\n");
  fs.writeFileSync(path.join(live, "superwall", "workflows", "dashboard", "setup.md"), "# LIVE setup\n");
  process.env.SUPERWALL_AGENT_SKILLS_DIR = live;
  const composed = loadBundledSkill("superwall-dashboard", "setup");
  assert.match(composed, /^# LIVE dashboard playbook\n\n# LIVE setup$/);
  assert.notEqual(composed, bundled);
  assert.match(loadBundledSkill("superwall-review", "ios"), /# Review Superwall - iOS/);
  fs.rmSync(live, { recursive: true, force: true });
});
