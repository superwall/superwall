import { test } from "node:test";
import assert from "node:assert/strict";
import { createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import { asaProxy, asaUpstreamPath, listAsaApps, pickAsaApp, type AsaApp } from "@/core/api/asa";
import type { Session } from "@/core/auth/storage";

const SESSION: Session = {
  apiKey: "sk_x",
  host: "https://api.example.com",
  createdAt: "n",
};
const api = createSuperwallApi(SESSION).forOrg("77");

function record(body: unknown = { data: [] }): {
  url?: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
} {
  const rec: { url?: string; method?: string; body?: unknown; headers?: Record<string, string> } =
    {};
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    rec.url = String(input);
    rec.method = init.method;
    rec.body = init.body ? JSON.parse(String(init.body)) : undefined;
    rec.headers = init.headers as Record<string, string>;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return rec;
}

test("asaUpstreamPath prefixes Apple's version unless already given", () => {
  assert.equal(asaUpstreamPath("/campaigns"), "/api/v5/campaigns");
  assert.equal(asaUpstreamPath("/api/v5/campaigns"), "/api/v5/campaigns");
  assert.throws(() => asaUpstreamPath("campaigns"), /must start with/);
});

test("asaProxy targets the org's proxy for the app and forwards the org context", async () => {
  const rec = record();
  await asaProxy(api, "5", "get", "/campaigns?limit=1", undefined, { orgId: "9" });
  assert.equal(
    rec.url,
    "https://api.example.com/v2/organizations/77/apple-search-ads/proxy/5/api/v5/campaigns?limit=1",
  );
  assert.equal(rec.method, "GET");
  assert.equal(rec.headers?.["x-ap-context"], "orgId=9");

  await asaProxy(api, "5", "post", "/campaigns/find", { conditions: [] });
  assert.equal(rec.method, "POST");
  assert.deepEqual(rec.body, { conditions: [] });
  assert.equal(rec.headers?.["x-ap-context"], undefined);

  await asaProxy(api, "5", "put", "/campaigns/1");
  assert.equal(rec.method, "PUT");
  assert.deepEqual(rec.body, {});

  await asaProxy(api, "5", "delete", "/campaigns/1");
  assert.equal(rec.method, "DELETE");
  assert.equal(rec.body, undefined);

  await assert.rejects(asaProxy(api, "5", "patch", "/campaigns/1"), /Unsupported method/);
});

test("asaProxy needs the app's account", async () => {
  const orgless = createSuperwallApi(SESSION);
  await assert.rejects(asaProxy(orgless, "5", "get", "/me"), /needs the app's account/);
});

test("listAsaApps flattens iOS apps with their connection state", async () => {
  record({
    data: [
      {
        id: 1,
        name: "Acme",
        applications: [
          { id: 10, name: "Acme iOS", platform: "ios", apple_search_ads_configured: true },
          { id: 11, name: "Acme Android", platform: "android", apple_search_ads_configured: true },
          { id: 12, name: "Acme Web", platform: "web" },
          { id: 13, name: "Acme iOS 2", platform: "iOS", apple_search_ads_configured: false },
        ],
      },
      { id: 2, name: "Empty" },
    ],
  });
  const apps = await listAsaApps(api);
  assert.deepEqual(apps, [
    { id: "10", name: "Acme iOS", project: "Acme", connected: true },
    { id: "13", name: "Acme iOS 2", project: "Acme", connected: false },
  ]);
});

test("pickAsaApp resolves the flag, the single connected app, or explains", () => {
  const apps: AsaApp[] = [
    { id: "10", name: "Acme iOS", connected: true },
    { id: "13", name: "Other", connected: false },
  ];
  assert.equal(pickAsaApp(apps, "13").id, "13");
  assert.equal(pickAsaApp(apps, "Acme iOS").id, "10");
  assert.equal(pickAsaApp(apps, undefined).id, "10");
  assert.throws(() => pickAsaApp(apps, "99"), /No iOS app 99/);
  assert.throws(() => pickAsaApp([apps[1]!], undefined), /isn't connected on any app/);
  assert.throws(
    () => pickAsaApp([apps[0]!, { id: "20", name: "Two", connected: true }], undefined),
    /connected on several apps \(Acme iOS \(10\), Two \(20\)\)/,
  );
});
