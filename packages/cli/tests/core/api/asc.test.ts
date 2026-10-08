import { test } from "node:test";
import assert from "node:assert/strict";
import { createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import {
  createAscConfig,
  deleteAscConfig,
  getAppNotificationUrl,
  saveAppAscKey,
  saveAppPurchaseKey,
  updateAscConfig,
} from "@/core/api/asc";
import { generateStoreKit } from "@/core/dashboard/storekit";
import type { Session } from "@/core/auth/storage";

const SESSION: Session = {
  apiKey: "sk_x",
  orgId: "77",
  host: "https://api.example.com",
  createdAt: "n",
};
const api = createSuperwallApi(SESSION);

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
  await deleteAscConfig(api, "T1");
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

test("updateAscConfig rotates the key on an existing team", async () => {
  const rec = record();
  await updateAscConfig(api, "T1", { ...CREDS, accountName: "Acme" });
  assert.equal(rec.url, "https://api.example.com/v2/organizations/77/app-store-connect/T1");
  assert.equal(rec.method, "PATCH");
  assert.deepEqual(rec.body, {
    key_id: "K",
    issuer_id: "I",
    private_key: "PEM",
    account_name: "Acme",
  });
});

test("saveAppAscKey puts the key on the application", async () => {
  const rec = record();
  await saveAppAscKey(api, APP, CREDS);
  assert.equal(
    rec.url,
    "https://api.example.com/v2/projects/5/applications/8/integrations/app-store-connect/configuration",
  );
  assert.equal(rec.method, "PUT");
  assert.deepEqual(rec.body, { key_id: "K", issuer_id: "I", private_key: "PEM" });
});

test("saveAppPurchaseKey sends the bundle id with the key", async () => {
  const rec = record();
  await saveAppPurchaseKey(api, APP, { ...CREDS, bundleId: "com.acme.app" });
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
  assert.equal(await getAppNotificationUrl(api, APP), "https://hook.test/?pk=1");
});
