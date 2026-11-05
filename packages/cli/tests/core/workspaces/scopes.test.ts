import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeForRoute } from "@/core/workspaces/scopes";

test("each route family names the read scope it needs", () => {
  for (const [path, scope] of [
    ["/v2/organizations/1/query", "data:read"],
    ["/v2/projects", "projects:read"],
    ["/v2/projects/1/custom-stores", "custom_stores:read"],
    ["/v2/applications/1/settings", "applications:read"],
    ["/v2/paywalls/1", "paywalls:read"],
    ["/v2/charts/data", "charts:read"],
    ["/v2/demand-score/query", "charts:read"],
    ["/v3/users/a", "users:read"],
    ["/v2/retention-messages", "retention_messages:read"],
  ] as const) {
    assert.equal(scopeForRoute("GET", path), scope, path);
  }
  assert.equal(scopeForRoute("POST", "/v2/charts/data"), "charts:read");
  assert.equal(scopeForRoute("POST", "/v2/organizations/1/query"), "data:read");
  assert.equal(scopeForRoute("POST", "/v2/users/query"), "users:read");
});

test("writes and routes it doesn't know are left to the API", () => {
  assert.equal(scopeForRoute("DELETE", "/v2/paywalls/1"), undefined);
  assert.equal(scopeForRoute("POST", "/v2/products"), undefined);
  assert.equal(scopeForRoute("GET", "/v2/me"), undefined);
  assert.equal(scopeForRoute("GET", "/v2/projectsish"), undefined);
});
