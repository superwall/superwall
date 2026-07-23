import { test } from "node:test";
import assert from "node:assert/strict";
import { actionById } from "@/core/agent/actions";
import { checkSkillsSync, loadBundledSkill } from "@/core/agent/skills";

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

  assert.equal(checkSkillsSync(undefined, "1.0.0", now), "stale");
  const fresh = { cliVersion: "1.0.0", syncedAt: at(now - 60_000), sourceSha: "abc" };
  assert.equal(checkSkillsSync(fresh, "1.0.0", now), "fresh");
  assert.equal(checkSkillsSync(fresh, "1.1.0", now), "stale");
  assert.equal(
    checkSkillsSync({ cliVersion: "1.0.0", syncedAt: at(now - 2 * day) }, "1.0.0", now),
    "verify",
  );
  assert.equal(
    checkSkillsSync({ cliVersion: "1.0.0", syncedAt: "garbage" }, "1.0.0", now),
    "stale",
  );
});

test("missing bundled references fail closed", () => {
  assert.throws(
    () => loadBundledSkill("superwall-review", "missing-framework"),
    /Bundled skill asset is missing: superwall-review\/references\/missing-framework\.md/,
  );
});
