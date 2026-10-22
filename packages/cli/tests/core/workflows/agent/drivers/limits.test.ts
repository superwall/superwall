import assert from "node:assert/strict";
import { test } from "node:test";
import { isUsageLimitText } from "@/core/workflows/agent/drivers/limits";

test("recognizes provider session and hosted credit limits", () => {
  assert.equal(isUsageLimitText("You've hit your session limit · resets 5pm"), true);
  assert.equal(isUsageLimitText("You've hit your usage limit. Try again tomorrow."), true);
  assert.equal(isUsageLimitText("Your hosted Superwall Agent credit is exhausted."), true);
  assert.equal(isUsageLimitText("Weekly limit reached for this plan"), true);
  assert.equal(isUsageLimitText("You have no credits remaining"), true);
  assert.equal(isUsageLimitText("The migration failed to compile."), false);
  assert.equal(isUsageLimitText(""), false);
  assert.equal(isUsageLimitText(undefined), false);
});
