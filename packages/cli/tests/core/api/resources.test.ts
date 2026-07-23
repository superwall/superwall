import { test } from "node:test";
import assert from "node:assert/strict";
import { SuperwallApi } from "@/core/api/client";
import {
  createCampaign,
  createEntitlement,
  createProduct,
  listResource,
  rowName,
  type Scope,
} from "@/core/api/resources";
import type { Session } from "@/core/auth/storage";

const SESSION: Session = {
  apiKey: "sk_x",
  host: "https://api.example.com",
  createdAt: "n",
};
const api = SuperwallApi.of(SESSION);
const SCOPE: Scope = { projectId: "9", applicationId: "42", projectName: "P" };

interface Rec {
  url: string;
  method?: string;
  body?: unknown;
}
function mockFetch(responder: (url: string) => unknown): Rec[] {
  const recs: Rec[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    recs.push({
      url,
      method: init.method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(responder(url)), { status: 200 });
  }) as typeof fetch;
  return recs;
}

test("listResource scopes products by project_id and campaigns by application_id", async () => {
  let recs = mockFetch(() => ({ data: [], has_more: false }));
  await listResource(api, "products", SCOPE);
  assert.match(recs[0]!.url, /\/v2\/products\?project_id=9/);

  recs = mockFetch(() => ({ data: [], has_more: false }));
  await listResource(api, "campaigns", SCOPE);
  assert.match(recs[0]!.url, /\/v2\/campaigns\?application_id=42/);
});

test("createEntitlement posts {project_id, identifier}", async () => {
  const recs = mockFetch(() => ({ id: 1, identifier: "pro" }));
  await createEntitlement(api, SCOPE, "pro");
  assert.equal(recs[0]!.method, "POST");
  assert.deepEqual(recs[0]!.body, { project_id: "9", identifier: "pro" });
});

test("createProduct includes name only when provided", async () => {
  let recs = mockFetch(() => ({ id: 1 }));
  await createProduct(api, SCOPE, "com.app.pro");
  assert.deepEqual(recs[0]!.body, {
    project_id: "9",
    identifier: "com.app.pro",
  });

  recs = mockFetch(() => ({ id: 1 }));
  await createProduct(api, SCOPE, "com.app.pro", { name: "Pro" });
  assert.deepEqual(recs[0]!.body, {
    project_id: "9",
    identifier: "com.app.pro",
    name: "Pro",
  });
});

test("createCampaign posts placement + holdout audience and requires an app", async () => {
  const recs = mockFetch(() => ({ id: 7 }));
  await createCampaign(api, SCOPE, "My campaign", "onboarding_complete");
  assert.deepEqual(recs[0]!.body, {
    application_id: "42",
    description: "My campaign",
    placements: [{ event_name: "onboarding_complete" }],
    audiences: [{ variants: [{ type: "holdout", percentage: 100, paywall: null }] }],
  });
  assert.throws(() => createCampaign(api, { projectId: "9" }, "x", "p"), /no application/);
});

test("rowName prefers name, then identifier, then id", () => {
  assert.equal(rowName({ id: 1, name: "N", identifier: "I" }), "N");
  assert.equal(rowName({ id: 1, identifier: "I" }), "I");
  assert.equal(rowName({ id: 5 }), "5");
});
