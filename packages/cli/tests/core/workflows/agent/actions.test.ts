import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIONS, actionById, type ActionContext } from "@/core/workflows/agent/actions";
import { frameworkByIntegration } from "@/core/codebase/frameworks";
import { Integration } from "@/environment";

function context(integration: Integration, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    app: {
      path: "/tmp/app",
      relPath: ".",
      name: "app",
      framework: frameworkByIntegration[integration],
      integration,
      score: 1,
    },
    apiKey: "pk_test",
    existing: { sdkInstalled: false, configureFound: false, fullyIntegrated: false },
    ...extra,
  };
}

test("every action is listed once, under its own id", () => {
  assert.deepEqual(
    ACTIONS.map((action) => action.id),
    ["integrate", "review", "review-fix", "placements-review", "placements-implement", "dashboard-setup", "migrate"],
  );
  for (const action of ACTIONS) assert.equal(actionById[action.id], action);
});

test("review action is read-only and fix action is writable", () => {
  assert.equal(actionById.review.capabilities.filesystem, "read");
  assert.equal(actionById.review.capabilities.network, true);
  assert.equal(actionById.review.outputMode, "report");
  assert.equal(actionById["review-fix"].capabilities.filesystem, "write");
  assert.equal(actionById["review-fix"].outputMode, "silent");
});

test("integrate composes the playbook with the app's framework reference", () => {
  const { skill } = actionById.integrate.vars(context(Integration.expo));

  assert.match(skill ?? "", /^# Integrate the Superwall SDK/);
  assert.match(skill ?? "", /# Integrate Superwall - Expo/);
  assert.doesNotMatch(skill ?? "", /# Integrate Superwall - iOS/);
});

test("a framework without a reference gets the playbook alone", () => {
  const { skill } = actionById.integrate.vars(context(Integration.web));

  assert.match(skill ?? "", /^# Integrate the Superwall SDK/);
  assert.doesNotMatch(skill ?? "", /# Integrate Superwall - /);
});

test("review and its fix share the review skill, and the fix carries the prior report", () => {
  const review = actionById.review.vars(context(Integration.flutter));
  const fix = actionById["review-fix"].vars(context(Integration.flutter, { priorReport: "## Findings" }));
  const fixWithoutReport = actionById["review-fix"].vars(context(Integration.flutter));

  assert.match(review.skill ?? "", /# Review Superwall - Flutter/);
  assert.equal(fix.skill, review.skill);
  assert.equal(fix.prior_report, "## Findings");
  assert.equal(fixWithoutReport.prior_report, "");
});

test("placements compose the strategy and the framework reference, with campaigns when known", () => {
  const ctx = context(Integration.android, { campaigns: "onboarding", priorReport: "report" });
  const review = actionById["placements-review"].vars(ctx);
  const implement = actionById["placements-implement"].vars(ctx);
  const bare = actionById["placements-implement"].vars(context(Integration.android));

  assert.match(review.skill ?? "", /# Superwall placement strategy[\s\S]*# Superwall placements - Android \/ Kotlin/);
  assert.equal(review.campaigns, "onboarding");
  assert.equal(implement.skill, review.skill);
  assert.equal(implement.prior_report, "report");
  assert.equal(implement.campaigns, "onboarding");
  assert.equal(bare.prior_report, "");
  assert.equal(bare.campaigns, "");
  assert.equal(actionById["placements-review"].vars(context(Integration.android)).campaigns, "");
});

test("dashboard setup names the app key, or the app being worked on without one", () => {
  const withKey = actionById["dashboard-setup"].vars(context(Integration.swift));
  const withoutKey = actionById["dashboard-setup"].vars(context(Integration.swift, { apiKey: "" }));

  assert.match(withKey.skill ?? "", /^# Set up the Superwall dashboard/);
  assert.equal(withKey.app_key, "pk_test");
  assert.equal(withoutKey.app_key, "(the app you're working on)");
  assert.equal(actionById["dashboard-setup"].requiresOrgKey, true);
});

test("migrate picks the provider's reference and states the goal", () => {
  const full = actionById.migrate.vars(context(Integration.swift, { billingProvider: "RevenueCat" }));
  const paywalls = actionById.migrate.vars(
    context(Integration.swift, { billingProvider: "Adapty", migrateIntent: "paywalls" }),
  );

  assert.equal(full.provider, "RevenueCat");
  assert.equal(full.goal, "full migration");
  assert.match(full.skill ?? "", /# Migrate to Superwall[\s\S]*# RevenueCat → Superwall/);
  assert.equal(paywalls.goal, "paywalls only, keep Adapty for billing");
  assert.match(paywalls.skill ?? "", /# Adapty → Superwall/);
});

test("migrate without a known provider says so and composes the playbook alone", () => {
  const vars = actionById.migrate.vars(context(Integration.swift));

  assert.equal(vars.provider, "the current billing provider");
  assert.equal(vars.goal, "full migration");
  assert.match(vars.skill ?? "", /^# Migrate to Superwall/);
  assert.doesNotMatch(vars.skill ?? "", /→ Superwall/);
});
