import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, createSuperwallApi } from "@/core/api/client";
import {
  checkServerNotifications,
  copyAppKey,
  findIntegrations,
  importAppKey,
  listBundleIdSuggestions,
  listKeySources,
  RefusedByApi,
  removeAppKey,
  replaceRevenueProvider,
  updateBundleId,
  updateServerNotifications,
} from "@/core/api/integrations";
import { restoreFetch, useFetch } from "../../helpers/fetch";

afterEach(() => restoreFetch());

const HOST = "https://api.example.com";
const api = () => createSuperwallApi({ authMethod: "api_key", apiKey: "sk_x", host: HOST, createdAt: "now" });
const INTEGRATIONS = `${HOST}/internal/v2/applications/8/integrations`;
const APP = { projectId: "5", applicationId: "8" };
const APPLE = `${HOST}/v2/projects/5/applications/8/integrations/app-store-connect/notification-url/apple`;

const sent = (log: { url: string; method: string; body?: string }[]) =>
  log.map((entry) => [entry.method, entry.url, entry.body === undefined ? undefined : JSON.parse(entry.body)]);

test("the overview and revenue provider are read and replaced per application", async () => {
  const log = useFetch([
    { match: "/overview", body: { revenue_provider: "revenue_cat" } },
    { match: "/revenue-provider", body: { revenue_provider: "open_revenue" } },
  ]);
  assert.deepEqual(await findIntegrations(api(), "8"), { revenue_provider: "revenue_cat" });
  assert.equal(await replaceRevenueProvider(api(), "8", "open_revenue"), "open_revenue");
  assert.deepEqual(sent(log), [
    ["GET", `${INTEGRATIONS}/overview`, undefined],
    ["PATCH", `${INTEGRATIONS}/revenue-provider`, { revenue_provider: "open_revenue" }],
  ]);
});

test("App Store keys are listed, copied, imported and removed", async () => {
  const log = useFetch([{ match: "/app-store-keys", body: { ok: true } }]);
  await listKeySources(api(), "8");
  await copyAppKey(api(), "8", { kind: "api_key", from: "9", confirmed: false });
  await copyAppKey(api(), "8", { kind: "purchase_key", from: "9", confirmed: true });
  await importAppKey(api(), "8", "api_key");
  await removeAppKey(api(), "8", "purchase_key");
  assert.deepEqual(sent(log), [
    ["GET", `${INTEGRATIONS}/app-store-keys/copy-sources`, undefined],
    ["POST", `${INTEGRATIONS}/app-store-keys/copy`, { kind: "api_key", source_application_id: "9" }],
    ["POST", `${INTEGRATIONS}/app-store-keys/copy`, { kind: "purchase_key", source_application_id: "9", confirmed: true }],
    ["POST", `${INTEGRATIONS}/app-store-keys/import`, { kind: "api_key" }],
    ["DELETE", `${INTEGRATIONS}/app-store-keys/purchase_key`, undefined],
  ]);
});

test("Apple's server notification URLs are checked and set, optionally switching the revenue provider", async () => {
  const log = useFetch([{ match: "/notification-url/apple", body: { status: "set" } }]);
  assert.deepEqual(await checkServerNotifications(api(), APP), { status: "set" });
  await updateServerNotifications(api(), APP, { setRevenueProvider: false });
  await updateServerNotifications(api(), APP, { setRevenueProvider: true });
  assert.deepEqual(sent(log), [
    ["GET", APPLE, undefined],
    ["PUT", APPLE, {}],
    ["PUT", APPLE, { set_revenue_provider: true }],
  ]);
});

test("bundle ids are suggested and saved, with the App Store id and replace only when given", async () => {
  const log = useFetch([
    { match: "/bundle-id-suggestions", body: { available: true, candidates: [] } },
    { match: "/bundle-id", body: { bundle_id: "com.acme", app_store_id: null } },
  ]);
  await listBundleIdSuggestions(api(), "8");
  await updateBundleId(api(), "8", { bundleId: "com.acme", replace: false });
  await updateBundleId(api(), "8", { bundleId: "com.acme", appStoreId: "123", replace: true });
  assert.deepEqual(sent(log), [
    ["GET", `${HOST}/internal/v2/applications/8/bundle-id-suggestions`, undefined],
    ["POST", `${HOST}/internal/v2/applications/8/bundle-id`, { bundle_id: "com.acme" }],
    ["POST", `${HOST}/internal/v2/applications/8/bundle-id`, { bundle_id: "com.acme", app_store_id: "123", replace: true }],
  ]);
});

test("an API without the endpoint is reported as not supporting it yet, while real errors pass through", async () => {
  useFetch([{ match: "/app-store-keys/import", status: 404, text: "Not Found" }]);
  await assert.rejects(importAppKey(api(), "8", "api_key"), (error: Error) => {
    assert.ok(error instanceof RefusedByApi);
    assert.equal(
      error.message,
      `The Superwall API at ${HOST} can't import a key your organization already has yet. Nothing was changed.`,
    );
    return true;
  });

  useFetch([{ match: "/app-store-keys/import", status: 404, body: { message: "No such application" } }]);
  await assert.rejects(importAppKey(api(), "8", "api_key"), (error: Error) => {
    assert.ok(error instanceof ApiError && !(error instanceof RefusedByApi));
    assert.equal(error.message, "No such application");
    return true;
  });

  useFetch([{ match: "/app-store-keys/import", status: 500, text: "boom" }]);
  await assert.rejects(importAppKey(api(), "8", "api_key"), (error: Error) => error instanceof ApiError && error.status === 500);
});
