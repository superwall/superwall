import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createSuperwallApi } from "@/core/api/client";
import {
  ascProxy,
  ascProxyGet,
  listAscConfigs,
  createAscConfig,
  removeAscConfig,
  findAppNotificationUrl,
  replaceAppAscKey,
  replaceAppPurchaseKey,
  replaceAscConfig,
} from "@/core/app-store-connect/api/client";
import { generateStoreKit } from "@/core/main/storekit";
import type { Session } from "@/core/account/storage";
import { restoreFetch, useFetch } from "../../../helpers/fetch";

afterEach(() => restoreFetch());

const SESSION: Session = {
  apiKey: "sk_x",
  host: "https://api.example.com",
  createdAt: "n",
};
const api = createSuperwallApi(SESSION).forOrg("77");

function record(): { url?: string; method?: string; body?: unknown } {
  const rec: { url?: string; method?: string; body?: unknown } = {};
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    rec.url = String(input);
    rec.method = init.method;
    rec.body = init.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify({ team_id: "T1" }), { status: 200 });
  }) as typeof fetch;
  return rec;
}

test("createAscConfig posts snake_case creds to the org path", async () => {
  const rec = record();
  await createAscConfig(api, { keyId: "K", issuerId: "I", privateKey: "PEM" });
  assert.equal(rec.url, "https://api.example.com/v2/organizations/77/app-store-connect");
  assert.equal(rec.method, "POST");
  assert.deepEqual(rec.body, {
    key_id: "K",
    issuer_id: "I",
    private_key: "PEM",
  });
});

test("deleteAscConfig targets the team id", async () => {
  const rec = record();
  await removeAscConfig(api, "T1");
  assert.equal(rec.url, "https://api.example.com/v2/organizations/77/app-store-connect/T1");
  assert.equal(rec.method, "DELETE");
});

test("generateStoreKit maps product identifiers into a valid-ish config", () => {
  const sk = generateStoreKit([
    { id: 1, identifier: "com.app.pro" },
    { id: 2, name: "com.app.plus" },
  ]) as {
    products: Array<{ productID: string }>;
    version: { major: number };
  };
  assert.equal(sk.products.length, 2);
  assert.deepEqual(
    sk.products.map((p) => p.productID),
    ["com.app.pro", "com.app.plus"],
  );
  assert.equal(sk.version.major, 3);
});

const APP = { projectId: "5", applicationId: "8" };
const CREDS = { keyId: "K", issuerId: "I", privateKey: "PEM" };

test("replaceAscConfig replaces a team's key and asks for the team check", async () => {
  const rec = record();
  await replaceAscConfig(api, "T1", { ...CREDS, accountName: "Acme" });
  assert.equal(rec.url, "https://api.example.com/v2/organizations/77/app-store-connect/T1");
  assert.equal(rec.method, "PATCH");
  assert.deepEqual(rec.body, {
    key_id: "K",
    issuer_id: "I",
    private_key: "PEM",
    validate: true,
    account_name: "Acme",
  });
});

test("saveAppAscKey puts the key on the application", async () => {
  const rec = record();
  await replaceAppAscKey(api, APP, CREDS);
  assert.equal(
    rec.url,
    "https://api.example.com/v2/projects/5/applications/8/integrations/app-store-connect/configuration",
  );
  assert.equal(rec.method, "PUT");
  assert.deepEqual(rec.body, { key_id: "K", issuer_id: "I", private_key: "PEM" });
});

test("saveAppPurchaseKey sends the bundle id with the key", async () => {
  const rec = record();
  await replaceAppPurchaseKey(api, APP, { ...CREDS, bundleId: "com.acme.app" });
  assert.equal(
    rec.url,
    "https://api.example.com/v2/projects/5/applications/8/integrations/in-app-purchase/configuration",
  );
  assert.deepEqual(rec.body, {
    bundle_id: "com.acme.app",
    key_id: "K",
    issuer_id: "I",
    private_key: "PEM",
  });
});

test("getAppNotificationUrl returns the application's webhook URL", async () => {
  globalThis.fetch = (async (input: string | URL) => {
    assert.equal(
      String(input),
      "https://api.example.com/v2/projects/5/applications/8/integrations/app-store-connect/notification-url",
    );
    return new Response(JSON.stringify({ url: "https://hook.test/?pk=1" }), { status: 200 });
  }) as typeof fetch;
  assert.equal(await findAppNotificationUrl(api, APP), "https://hook.test/?pk=1");
});

test("listAscConfigs reads the organization's App Store Connect teams", async () => {
  const log = useFetch([{ match: "/app-store-connect", body: { data: [{ team_id: "T1" }] } }]);
  assert.deepEqual(await listAscConfigs(api), [{ team_id: "T1" }]);
  assert.equal(log[0]?.url, "https://api.example.com/v2/organizations/77/app-store-connect");
  useFetch([{ match: "/app-store-connect", body: {} }]);
  assert.deepEqual(await listAscConfigs(api), []);
});

test("App Store Connect calls need an organization", async () => {
  const log = useFetch([]);
  await assert.rejects(listAscConfigs(createSuperwallApi(SESSION)), {
    message: "App Store Connect needs the app's account - pass --app <id>.",
  });
  assert.deepEqual(log, []);
});

test("createAscConfig names the account when given one, and replaceAscConfig leaves it out when not", async () => {
  const rec = record();
  await createAscConfig(api, { ...CREDS, accountName: "Acme" });
  assert.deepEqual(rec.body, { key_id: "K", issuer_id: "I", private_key: "PEM", account_name: "Acme" });
  await replaceAscConfig(api, "T1", CREDS);
  assert.deepEqual(rec.body, { key_id: "K", issuer_id: "I", private_key: "PEM", validate: true });
});

test("replaceAppPurchaseKey asks to set the app's bundle id when told to", async () => {
  const rec = record();
  await replaceAppPurchaseKey(api, APP, { ...CREDS, bundleId: "com.acme.app", setApplicationBundleId: true });
  assert.equal((rec.body as Record<string, unknown>).set_application_bundle_id, true);
});

test("ascProxy sends each verb through the team's proxy, with an empty body by default", async () => {
  const log = useFetch([{ match: "/proxy/T1/", body: { data: [] } }]);
  const base = "https://api.example.com/v2/organizations/77/app-store-connect/proxy/T1";
  assert.deepEqual(await ascProxyGet(api, "T1", "/v1/apps"), { data: [] });
  await ascProxy(api, "T1", "post", "/v1/subscriptions", { data: { type: "subscriptions" } });
  await ascProxy(api, "T1", "post", "/v1/subscriptions");
  await ascProxy(api, "T1", "patch", "/v1/subscriptions/S1");
  await ascProxy(api, "T1", "patch", "/v1/subscriptions/S1", { data: { id: "S1" } });
  await ascProxy(api, "T1", "delete", "/v1/subscriptions/S1");
  assert.deepEqual(
    log.map((entry) => [entry.method, entry.url, entry.body]),
    [
      ["GET", `${base}/v1/apps`, undefined],
      ["POST", `${base}/v1/subscriptions`, '{"data":{"type":"subscriptions"}}'],
      ["POST", `${base}/v1/subscriptions`, "{}"],
      ["PATCH", `${base}/v1/subscriptions/S1`, "{}"],
      ["PATCH", `${base}/v1/subscriptions/S1`, '{"data":{"id":"S1"}}'],
      ["DELETE", `${base}/v1/subscriptions/S1`, undefined],
    ],
  );
});
