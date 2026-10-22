import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { actionById, type ActionContext } from "@/core/workflows/agent/actions";
import { buildActionPrompt, buildCopyPrompt, readCommandments, readPrompt } from "@/core/workflows/agent/prompt";
import { frameworkByIntegration } from "@/core/codebase/frameworks";
import { DASHBOARD_URL, Integration } from "@/environment";

function context(extra: Partial<ActionContext> = {}, details?: string): ActionContext {
  return {
    app: {
      path: "/tmp/app",
      relPath: ".",
      name: "app",
      framework: frameworkByIntegration[Integration.expo],
      integration: Integration.expo,
      score: 1,
      ...(details === undefined ? {} : { details }),
    },
    apiKey: "pk_live",
    existing: { sdkInstalled: true, configureFound: false, fullyIntegrated: false },
    ...extra,
  };
}

test("a conditional block is kept only when its variable has a value", () => {
  const withReport = readPrompt("actions/review-fix.xml", { prior_report: "FOUND: missing restore", skill: "SKILL" });
  const withoutReport = readPrompt("actions/review-fix.xml", { prior_report: "", skill: "SKILL" });

  assert.match(withReport, /FOUND: missing restore/);
  assert.doesNotMatch(withoutReport, /FOUND|\{\{/);
  assert.match(withoutReport, /SKILL/);
  assert.doesNotMatch(withoutReport, /\n{3,}/);
  assert.equal(withoutReport, withoutReport.trim());
});

test("a missing variable is an error naming it and the template", () => {
  assert.throws(() => readPrompt("actions/review.xml"), /Missing prompt variable "skill" in actions\/review\.xml/);
});

test("the commandments are the packaged protocol file", () => {
  assert.equal(readCommandments(), readFileSync("prompts/commandments.xml", "utf8").trim());
});

test("an action prompt starts with the app context and ends with the action", () => {
  const prompt = buildActionPrompt(actionById.integrate, context({}, "Expo 52.0.0"));
  const [contextBlock, actionBlock] = prompt.split("\n\n<");

  assert.match(contextBlock ?? "", /<platform>Expo \(React Native\) \(Expo 52\.0\.0\)<\/platform>/);
  assert.match(contextBlock ?? "", /<app_directory>\/tmp\/app<\/app_directory>/);
  assert.match(contextBlock ?? "", /pk_live/);
  assert.match(contextBlock ?? "", /<sdk_installed>yes<\/sdk_installed>/);
  assert.match(contextBlock ?? "", /<configure_present>no<\/configure_present>/);
  assert.match(contextBlock ?? "", /<docs>https:\/\/superwall\.com\/docs\/expo<\/docs>/);
  assert.ok(contextBlock?.includes(DASHBOARD_URL));
  assert.match(actionBlock ?? "", /# Integrate Superwall - Expo/);
});

test("the context says when there is no key, no SDK and no platform details", () => {
  const prompt = buildActionPrompt(
    actionById.review,
    context({ apiKey: "", existing: { sdkInstalled: false, configureFound: true, fullyIntegrated: false } }),
  );

  assert.match(prompt, /<platform>Expo \(React Native\)<\/platform>/);
  assert.match(prompt, />\(not provided\)</);
  assert.match(prompt, /<sdk_installed>no<\/sdk_installed>/);
  assert.match(prompt, /<configure_present>yes<\/configure_present>/);
});

test("the copy prompt drops the [STATUS] lines only the headless runner understands", () => {
  const full = buildActionPrompt(actionById.integrate, context());
  const copy = buildCopyPrompt(actionById.integrate, context());

  assert.match(full, /\[STATUS\]/);
  assert.doesNotMatch(copy, /\[STATUS\]/);
  assert.match(copy, /# Integrate Superwall - Expo/);
  assert.equal(copy, copy.trimEnd());
});
