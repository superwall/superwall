import { test } from "node:test";
import assert from "node:assert/strict";
import { actionById, FRAMEWORK_REF } from "@/core/agent/actions";
import { Integration } from "@/environment";
import {
  SKILLS_INSTALL_SOURCE,
  SKILLS_REF,
  checkSkillsSync,
  knownSkills,
  loadBundledSkill,
  normalizeSkillFrontmatter,
  normalizeSkillsDir,
} from "@/core/agent/skills";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("review uses the broad setup skill rather than the placement skill", () => {
  const body = loadBundledSkill("superwall-review", "ios");

  assert.match(body, /Review the integration as a system, not as a placement inventory/);
  assert.match(body, /Purchases & subscriptions/);
  assert.match(body, /Deep links and Web Checkout/);
  assert.match(body, /Analytics events becoming placements is recommended/);
  assert.doesNotMatch(body, /Review Superwall - Expo/);
});

test("review composes exactly one framework reference", () => {
  const cases = [
    ["ios", "iOS / Swift"],
    ["android", "Android / Kotlin"],
    ["expo", "Expo"],
    ["react-native", "React Native"],
    ["flutter", "Flutter"],
  ] as const;

  for (const [reference, heading] of cases) {
    const body = loadBundledSkill("superwall-review", reference);
    assert.match(body, new RegExp(`# Review Superwall - ${heading}`));
    for (const [, other] of cases) {
      if (other !== heading) assert.doesNotMatch(body, new RegExp(`# Review Superwall - ${other}`));
    }
  }
});

test("review action is read-only and fix action is writable", () => {
  assert.equal(actionById.review.capabilities.filesystem, "read");
  assert.equal(actionById.review.capabilities.network, true);
  assert.equal(actionById.review.outputMode, "report");
  assert.equal(actionById["review-fix"].capabilities.filesystem, "write");
  assert.equal(actionById["review-fix"].outputMode, "silent");
});

test("skills sync: stale on missing/changed CLI version, fresh within a day, verify after", () => {
  const now = Date.parse("2026-07-15T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(ms).toISOString();

  assert.equal(checkSkillsSync(undefined, "1.0.0", "main", now), "stale");
  const fresh = { cliVersion: "1.0.0", syncedAt: at(now - 60_000), sourceSha: "abc", ref: "main" };
  assert.equal(checkSkillsSync(fresh, "1.0.0", "main", now), "fresh");
  assert.equal(checkSkillsSync(fresh, "1.1.0", "main", now), "stale");
  assert.equal(checkSkillsSync(fresh, "1.0.0", "next", now), "stale");
  assert.equal(
    checkSkillsSync({ cliVersion: "1.0.0", syncedAt: at(now - 2 * day), ref: "main" }, "1.0.0", "main", now),
    "verify",
  );
  assert.equal(
    checkSkillsSync({ cliVersion: "1.0.0", syncedAt: "garbage", ref: "main" }, "1.0.0", "main", now),
    "stale",
  );
});

test("the skills source follows the channel", () => {
  const original = process.env.SUPERWALL_CHANNEL;
  try {
    delete process.env.SUPERWALL_CHANNEL;
    assert.equal(SKILLS_REF(), "main");
    assert.equal(SKILLS_INSTALL_SOURCE(), "superwall/skills");
    assert.deepEqual(
      knownSkills().map((s) => s.name).filter((n) => /framework|paywall-migrate|screen-migrate/.test(n)),
      [],
    );
    process.env.SUPERWALL_CHANNEL = "nightly";
    assert.equal(SKILLS_REF(), "main");
    process.env.SUPERWALL_CHANNEL = "next";
    assert.equal(SKILLS_REF(), "next");
    assert.equal(SKILLS_INSTALL_SOURCE(), "https://github.com/superwall/skills/tree/next");
    assert.ok(knownSkills().some((s) => s.name === "superwall-framework"));
  } finally {
    process.env.SUPERWALL_CHANNEL = original;
  }
});

test("missing bundled references fail closed", () => {
  assert.throws(
    () => loadBundledSkill("superwall-review", "missing-framework"),
    /Bundled skill asset is missing: superwall\/workflows\/review\/missing-framework\.md/,
  );
});

test("integrate, placements and screen migration carry an Android reference", () => {
  assert.match(loadBundledSkill("superwall-integrate", "android"), /# Integrate Superwall - Android \/ Kotlin/);
  assert.match(loadBundledSkill("superwall-placements", ["strategy", "android"]), /# Superwall placements - Android \/ Kotlin/);
  assert.match(loadBundledSkill("superwall-screen-migrate", "android"), /# Android source screens/);
  assert.equal(FRAMEWORK_REF[Integration.android], "android");
});

const field = (md: string, key: string) => {
  const raw = md.split("\n").find((line) => line.startsWith(`${key}: `))!.slice(key.length + 2);
  assert.ok(raw.startsWith('"'), `${key} should be quoted: ${raw}`);
  return JSON.parse(raw) as string;
};

test("frontmatter strict YAML rejects is quoted, and keeps its text", () => {
  const description =
    "Animate a tap-through onboarding (quiz, survey, web2app flow) so the motion tells the story: each hand-off gets its own choreography";
  const md = `---\nname: animate-onboarding\ndescription: ${description}\nuser-invocable: true\n---\n\n# Body: untouched\n`;
  const normalized = normalizeSkillFrontmatter(md);
  assert.equal(field(normalized, "description"), description);
  assert.match(normalized, /^---\nname: animate-onboarding\n/);
  assert.match(normalized, /\nuser-invocable: true\n---\n/);
  assert.ok(normalized.endsWith("\n# Body: untouched\n"));
});

test("valid frontmatter and bodies are left exactly as they are", () => {
  const cases = [
    `---\nname: wwdc\ndescription: "Use this: quoted already"\n---\nbody`,
    `---\nname: a\ndescription: plain text, no colon space\n---\nbody`,
    `---\nname: a\ndescription: |\n  block: text\n---\nbody`,
    `# no frontmatter: at all`,
  ];
  for (const md of cases) assert.equal(normalizeSkillFrontmatter(md), md);
});

test("values with a comment marker or a reserved first character are quoted", () => {
  for (const value of ["uses # inside", "`code` first", "@scoped first", "ends with a colon:"]) {
    const normalized = normalizeSkillFrontmatter(`---\ndescription: ${value}\n---\n`);
    assert.equal(field(normalized, "description"), value);
  }
});

test("a checkout's skills are normalised in place", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-test-"));
  try {
    mkdirSync(join(root, "broken"));
    mkdirSync(join(root, "fine"));
    writeFileSync(join(root, "broken", "SKILL.md"), "---\nname: broken\ndescription: one: two\n---\n");
    writeFileSync(join(root, "fine", "SKILL.md"), "---\nname: fine\ndescription: fine\n---\n");
    writeFileSync(join(root, "README.md"), "not a skill");
    normalizeSkillsDir(root);
    assert.equal(field(readFileSync(join(root, "broken", "SKILL.md"), "utf8"), "description"), "one: two");
    assert.equal(readFileSync(join(root, "fine", "SKILL.md"), "utf8"), "---\nname: fine\ndescription: fine\n---\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
