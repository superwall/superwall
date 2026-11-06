import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError } from "@/core/api/client";
import { namesMissingResource, resolveReferenceHint, runApiRequest } from "@/core/api/request";
import { clearHomes, useHome } from "../../helpers/home";
import { restoreFetch, useFetch } from "../../helpers/fetch";

afterEach(() => {
  restoreFetch();
  clearHomes();
});

const spec = {
  info: { version: "2.0.0" },
  paths: {
    "/v2/campaigns/{id}/audiences/{audience_id}/variants": {
      post: { tags: ["Campaigns V2"], summary: "Create Variant", responses: {} },
    },
    "/v2/paywalls": {
      get: { tags: ["Paywalls V2"], summary: "List Paywalls", responses: {} },
      post: { tags: ["Paywalls V2"], summary: "Create Paywall", responses: {} },
    },
  },
};

test("a raw request that fails points at the endpoint, the right method, or a search", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", body: spec }]);
  assert.equal(
    await resolveReferenceHint("post", "/v2/campaigns/7/audiences/3/variants"),
    "Its parameters and body: superwall api docs /v2/campaigns/{id}/audiences/{audience_id}/variants post",
  );
  assert.equal(
    await resolveReferenceHint("delete", "/v2/paywalls"),
    "/v2/paywalls takes GET, POST, not DELETE: superwall api docs /v2/paywalls",
  );
  assert.equal(
    await resolveReferenceHint("get", "/v2/campaign/2071"),
    "No endpoint has this path. Search the reference: superwall api docs campaign",
  );
});

test("with the reference unreachable, the hint still says where to look", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", fail: true }]);
  assert.equal(await resolveReferenceHint("get", "/v2/x"), "The API reference: superwall api docs <words>");
});

test("a thing the API says is gone isn't told its endpoint doesn't exist", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", body: spec }]);
  const gone = (body: Record<string, unknown>, status = 404) => new ApiError("GET /v2/artifacts/99", status, JSON.stringify(body));
  const ctx = { output: { data: () => undefined } } as never;
  const failing = (error: Error) => ({ get: async () => { throw error; } }) as never;

  const missing = gone({ message: "No such Artifact: '99'", code: "resource_missing", type: "invalid_request_error" });
  await assert.rejects(runApiRequest(ctx, failing(missing), { verb: "get", path: "/v2/artifacts/99", data: [] }), (error: Error) => {
    assert.equal(error.message, "No such Artifact: '99'");
    return true;
  });
  assert.ok(namesMissingResource(gone({ message: "x", type: "resource_missing" })));
  assert.ok(namesMissingResource(gone({ message: "x", resource_type: "artifact" })));
  assert.ok(!namesMissingResource(gone({ message: "x", code: "resource_missing" }, 400)), "only a 404 says it's gone");
  assert.ok(!namesMissingResource(gone({ message: "Not Found" })));

  // A 404 with nothing typed about it is still a path the reference may not know.
  await assert.rejects(runApiRequest(ctx, failing(new ApiError("GET /v2/campaign/2071", 404, "")), { verb: "get", path: "/v2/campaign/2071", data: [] }), /No endpoint has this path/);
});
