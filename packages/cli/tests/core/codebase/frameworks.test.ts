import { test } from "node:test";
import assert from "node:assert/strict";
import { frameworkByIntegration, SUPPORTED_LABEL } from "@/core/codebase/frameworks";
import { Integration } from "@/environment";

test("the supported label lists every supported framework and ends with or", () => {
  assert.equal(
    SUPPORTED_LABEL,
    "Swift (iOS), Android (Kotlin), Expo (React Native), React Native, or Flutter",
  );
  assert.equal(frameworkByIntegration[Integration.web].supported, false);
  assert.doesNotMatch(SUPPORTED_LABEL, /Web/);
});
