import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@/core/api/client";
import { AscRequestError, describeAppleError, statusOf, withAppleErrors } from "@/core/app-store-connect/api/errors";

const PROXY = "POST /v2/organizations/7/app-store-connect/proxy/T1/v1/subscriptionPromotionalOffers";

const longConflict = JSON.stringify({
  errors: [
    {
      id: "0b6a4f2e-8c1d-4b7a-9e3f-5d2c1a0b9e8f",
      status: "409",
      code: "ENTITY_ERROR.ATTRIBUTE.INVALID",
      title: "An attribute value is invalid.",
      detail: "The provided entity includes an attribute with a value that is not valid for this subscription's promotional offers.",
      source: { pointer: "/data/attributes/offerEligibility" },
    },
  ],
});

test("a long Apple conflict keeps its code, detail and pointer, which the 200-character snippet cuts off", () => {
  assert.ok(longConflict.length > 200);
  const error = new ApiError(PROXY, 409, longConflict);
  assert.doesNotMatch(error.message, /offerEligibility/);
  assert.equal(
    describeAppleError(error),
    "App Store Connect refused POST /v1/subscriptionPromotionalOffers (409):\n" +
      "  • ENTITY_ERROR.ATTRIBUTE.INVALID: The provided entity includes an attribute with a value that is not valid for this subscription's promotional offers. (/data/attributes/offerEligibility)",
  );
});

test("every error is listed; a parameter stands in for a pointer; title then code fill in for a missing detail", () => {
  const body = JSON.stringify({
    errors: [
      { code: "PARAMETER_ERROR.INVALID", title: "A parameter has an invalid value", detail: "'x' is not a valid field name", source: { parameter: "fields[subscriptions]" } },
      { code: "STATE_ERROR", title: "The introductory offer is in an invalid state" },
      { code: "ENTITY_ERROR" },
      { detail: "No code at all" },
      "not an entry",
    ],
  });
  assert.equal(
    describeAppleError(new ApiError("GET /v1/subscriptions/1", 400, body)),
    [
      "App Store Connect refused GET /v1/subscriptions/1 (400):",
      "  • PARAMETER_ERROR.INVALID: 'x' is not a valid field name (fields[subscriptions])",
      "  • STATE_ERROR: The introductory offer is in an invalid state",
      "  • ENTITY_ERROR",
      "  • No code at all",
    ].join("\n"),
  );
});

test("a body that is not an Apple error document is not described", () => {
  for (const body of [undefined, "", "<html>Bad gateway</html>", "{}", JSON.stringify({ errors: [] }), JSON.stringify({ message: "Superwall said no" })]) {
    assert.equal(describeAppleError(new ApiError("GET x", 502, body)), undefined);
  }
});

test("withAppleErrors turns an Apple refusal into one that keeps the status, and leaves everything else alone", async () => {
  assert.equal(await withAppleErrors(async () => 1), 1);
  await assert.rejects(
    withAppleErrors(async () => {
      throw new ApiError(PROXY, 409, longConflict);
    }),
    (error: unknown) => {
      assert.ok(error instanceof AscRequestError);
      assert.equal(error.status, 409);
      assert.match(error.message, /\(\/data\/attributes\/offerEligibility\)$/);
      return true;
    },
  );
  const plain = new ApiError("GET x", 502, "<html>Bad gateway</html>");
  await assert.rejects(withAppleErrors(async () => { throw plain; }), (error: unknown) => error === plain);
  const offline = new Error("offline");
  await assert.rejects(withAppleErrors(async () => { throw offline; }), (error: unknown) => error === offline);
});

test("statusOf reads the status of either error, and nothing else", () => {
  assert.equal(statusOf(new AscRequestError("refused", 502)), 502);
  assert.equal(statusOf(new ApiError("GET x", 404, "")), 404);
  assert.equal(statusOf(new Error("plain")), undefined);
});
