import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { LoginRequiredError, requireApi } from "@/core/paywalls/project/session";

const originalKey = process.env.SUPERWALL_API_KEY;
const originalHome = process.env.HOME;

afterEach(() => {
  if (originalKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = originalKey;
  if (originalHome !== undefined) process.env.HOME = originalHome;
});

test("an API key authenticates without any stored session", async () => {
  process.env.SUPERWALL_API_KEY = "sk_test_123";
  process.env.HOME = "/nonexistent-home";

  const api = await requireApi(false);
  assert.equal(typeof api.org, "object");
});

test("no session and no key fails with both ways to authenticate", async () => {
  delete process.env.SUPERWALL_API_KEY;
  process.env.HOME = "/nonexistent-home";

  await assert.rejects(requireApi(false), (error: Error) => {
    assert.ok(error instanceof LoginRequiredError);
    // An agent reading this must learn both routes.
    assert.match(error.message, /superwall login/);
    assert.match(error.message, /SUPERWALL_API_KEY/);
    return true;
  });
});
