import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { resolveReferenceHint } from "@/core/api/request";
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
