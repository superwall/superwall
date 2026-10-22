import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as docs } from "@/commands/app-store-connect/api/docs";
import { command as get } from "@/commands/app-store-connect/api/get";
import { command as patch } from "@/commands/app-store-connect/api/patch";
import { formatReplacement, REPLACED, selectReplacement } from "@/core/app-store-connect/api/replaced";
import { renderAscDocs } from "@/core/app-store-connect/api/schema";
import { fakeAscApi } from "../../../helpers/asc-proxy";
import { useAscIndex } from "../../../helpers/asc-spec";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const use = (method: string, path: string) => selectReplacement(method, path)?.use;

test("each replaced endpoint names what Apple replaced it with", () => {
  assert.equal(use("POST", "/v1/subscriptionLocalizations"), "/v2/subscriptionLocalizations, on a subscription version");
  assert.equal(use("patch", "/v1/subscriptionGroupLocalizations/123"), "/v2/subscriptionGroupLocalizations, on a group version");
  assert.equal(use("GET", "/v1/subscriptions/601/subscriptionLocalizations?limit=200"), "/v1/subscriptionVersions/{id}/localizations");
  assert.equal(use("GET", "/v1/subscriptions/601/relationships/subscriptionLocalizations"), "/v1/subscriptionVersions/{id}/localizations");
  assert.equal(use("GET", "/v2/inAppPurchases/{id}/inAppPurchaseLocalizations"), "/v1/inAppPurchaseVersions/{id}/localizations");
  assert.equal(use("POST", "/v1/subscriptionSubmissions"), "/v1/reviewSubmissions with /v1/reviewSubmissionItems");
  assert.equal(use("POST", "/v1/subscriptionAvailabilities"), "/v1/subscriptionPlanAvailabilities");
  assert.equal(use("GET", "/v1/apps/555/inAppPurchases"), "/v1/apps/{id}/inAppPurchasesV2");
  assert.equal(use("GET", "/v1/apps/555/appStoreVersions?filter%5BappStoreState%5D=READY_FOR_SALE"), "filter[appVersionState] (the appStoreState attribute is replaced by appVersionState)");
  assert.equal(use("PATCH", "/v1/builds/B1/relationships/appEncryptionDeclaration"), "PATCH /v1/builds/{id} with the appEncryptionDeclaration relationship");
});

test("current endpoints are not flagged", () => {
  for (const [method, path] of [
    ["POST", "/v2/subscriptionLocalizations"],
    ["GET", "/v1/apps/555/inAppPurchasesV2"],
    ["GET", "/v1/apps/555/appStoreVersions?filter[appVersionState]=READY_FOR_DISTRIBUTION"],
    ["GET", "/v1/apps/555/appStoreVersions"],
    ["GET", "/v1/builds/B1/relationships/appEncryptionDeclaration"],
    ["GET", "/v1/appStoreVersions/V1/appStoreVersionExperimentsV2"],
    ["GET", "/v1"],
  ]) {
    assert.equal(selectReplacement(method ?? "", path ?? ""), undefined, `${method} ${path}`);
  }
});

test("a replacement reads as one sentence", () => {
  const rule = REPLACED.find((candidate) => candidate.query);
  assert.ok(rule);
  assert.equal(
    formatReplacement(rule),
    "Apple replaced filter[appStoreState] on /v1/apps/{id}/appStoreVersions in API 3.7: use filter[appVersionState] (the appStoreState attribute is replaced by appVersionState).",
  );
  assert.equal(
    formatReplacement(REPLACED[0] ?? rule),
    "Apple replaced /v1/subscriptionLocalizations in API 4.4.1: use /v2/subscriptionLocalizations, on a subscription version.",
  );
});

test("a raw request to a replaced endpoint warns, and still sends", async () => {
  const { api, requests } = fakeAscApi({ "GET /v1/inAppPurchases/701": { data: { id: "701" } } });
  const result = await runCommand(get, { api, args: { path: "/v1/inAppPurchases/701" } });
  assert.deepEqual(result.said("warn"), ["Apple replaced /v1/inAppPurchases in API 3.0: use /v2/inAppPurchases."]);
  assert.equal(requests.at(-1)?.path.endsWith("/v1/inAppPurchases/701"), true);
  useAscIndex();
  const patched = await runCommand(patch, { api, args: { path: "/v1/subscriptionLocalizations/L1" }, flags: { d: ["name=Pro"], force: true } });
  assert.match(patched.said("warn")[0] ?? "", /^Apple replaced \/v1\/subscriptionLocalizations in API 4\.4\.1/);
});

test("asc docs marks replaced endpoints in a schema and in search results", async () => {
  useAscIndex();
  const schema = renderAscDocs("/v1/subscriptionLocalizations", "post");
  assert.match(schema, /> ⚠ Apple replaced \/v1\/subscriptionLocalizations in API 4\.4\.1: use \/v2\/subscriptionLocalizations/);
  const search = renderAscDocs("subscriptionLocalizations");
  assert.match(search, /POST {3}\/v1\/subscriptionLocalizations.*⚠ replaced: use \/v2\/subscriptionLocalizations/);
  const result = await runCommand(docs, { args: { query: ["/v1/inAppPurchases/{id}"] }, flags: {}, json: true });
  assert.match((result.json as { markdown: string }).markdown, /Apple replaced \/v1\/inAppPurchases in API 3\.0/);
});
