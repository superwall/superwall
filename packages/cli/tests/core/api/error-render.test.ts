import assert from "node:assert/strict";
import { test } from "node:test";
import { errorAside, normalizeError } from "@/command";
import { ApiError } from "@/core/api/client";
import { NotLoggedInError } from "@/core/auth/errors";

const plain = (text: string): string => text.replace(/\[[0-9;]*m/g, "");

const envelope = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such pushed paywall version: '11111'",
    doc_url: "https://superwall.com/docs/errors/resource-missing",
    resource_type: "pushed paywall version",
    resource_id: "11111",
    _tag: "@superwall/api-schema/v2/errors/ResourceMissing",
    ...over,
  });

test("the headline is the API's message, never the request or the raw body", () => {
  const error = new ApiError("POST /v2/paywalls/208540/promote", 404, envelope());

  assert.equal(normalizeError(error).message, "No such pushed paywall version: '11111'");
  assert.equal(normalizeError(error).code, "api_error");
  assert.equal(normalizeError(error).status, 404);
});

test("doc_url rides along as a dim aside; the internal fields never render", () => {
  const error = new ApiError("POST /v2/paywalls/208540/promote", 404, envelope());
  const aside = errorAside(error).map(plain);

  assert.deepEqual(aside, ["https://superwall.com/docs/errors/resource-missing"]);
  assert.ok(!aside.join("\n").includes("_tag"));
  assert.ok(!aside.join("\n").includes("POST /v2"));
});

test("a hint leads the aside, above the doc url", () => {
  const error = new ApiError("POST /v2/paywalls/208540/promote", 404, envelope());
  error.hint = "Run `superwall promote` without --version to promote the latest.";

  assert.deepEqual(errorAside(error).map(plain), [
    "Run `superwall promote` without --version to promote the latest.",
    "https://superwall.com/docs/errors/resource-missing",
  ]);
});

test("only an unrecognized body earns the request line, where it aids debugging", () => {
  const opaque = new ApiError("GET /v2/paywalls/208540", 502, "<html>Bad Gateway</html>");

  assert.match(normalizeError(opaque).message, /^HTTP 502 — /);
  assert.deepEqual(errorAside(opaque).map(plain), ["GET /v2/paywalls/208540"]);
});

test("non-API errors render their own message with no aside", () => {
  assert.equal(normalizeError(new Error("Not a superwall project: /tmp/x")).message, "Not a superwall project: /tmp/x");
  assert.equal(normalizeError(new Error("x")).code, "command_error");
  assert.deepEqual(errorAside(new Error("x")), []);
  assert.equal(normalizeError(new NotLoggedInError()).code, "not_logged_in");
  assert.match(normalizeError(new NotLoggedInError()).message, /superwall login/);
});
