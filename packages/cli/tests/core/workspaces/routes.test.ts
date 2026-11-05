import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorkspaceRequestAllowed } from "@/core/workspaces/routes";

const allowed = (rows: readonly (readonly [string, string])[], narrowed: boolean) => {
  for (const [method, target] of rows) assert.equal(isWorkspaceRequestAllowed(method, target, narrowed), true, `${method} ${target}`);
};
const refused = (rows: readonly (readonly [string, string])[], narrowed: boolean) => {
  for (const [method, target] of rows) assert.equal(isWorkspaceRequestAllowed(method, target, narrowed), false, `${method} ${target}`);
};

test("what a workspace reaches, tied to no app", () => {
  allowed(
    [
      ["GET", "/v2/projects"],
      ["GET", "/v2/projects/12/customers/abc"],
      ["GET", "/dash-api/v2/paywalls/9"],
      ["PATCH", "/v2/paywalls/9"],
      ["POST", "/v2/campaigns/3/audiences"],
      ["POST", "/v2/entitlements/4/grants"],
      ["POST", "/v2/charts/data"],
      ["POST", "/v2/users/query"],
      ["GET", "/v3/users/abc/subscriptions"],
      ["POST", "/v2/organizations/7/query"],
      ["GET", "/v2/organizations/7/query?sql=select%201"],
      ["POST", "/v2/custom-stores/5/events"],
      ["PATCH", "/v2/projects/1/custom-stores/2"],
      ["get", "/v2/projects"],
    ],
    false,
  );
});

test("what it never reaches", () => {
  refused(
    [
      ["GET", "/v2/me"],
      ["GET", "/v2/me/organizations"],
      ["POST", "/v2/me/agent-token"],
      ["GET", "/v2/organizations"],
      ["GET", "/v2/organizations/7/access/api-keys"],
      ["POST", "/v2/organizations/7/access/members"],
      ["POST", "/v2/project-transfers/projects/1"],
      ["GET", "/v2/cli-agent/status"],
      ["POST", "/v2/paywalls/9/source-access"],
      ["POST", "/v2/paywalls/9/preview-token"],
      ["POST", "/v2/campaigns/3/audiences/4/generate-rule"],
      ["POST", "/v2/demand-score/ai-report"],
      ["POST", "/v2/projects"],
      ["PATCH", "/v2/projects/1"],
      ["POST", "/v2/projects/1/webhook_endpoints"],
      ["POST", "/v2/users/abc/attributes"],
      ["POST", "/v2/applications/1/dashboard_pins/preview"],
      ["POST", "/v2/imports/subscriptions"],
      ["GET", "/v2/audit-logs"],
      ["GET", "/internal/v2/admin/feature-flags"],
      ["POST", "/rpc"],
      ["GET", "/v2/workspaces"],
      ["GET", "/v2/somethingnew"],
      ["GET", "/v2/retention-onboarding/sandbox"],
    ],
    false,
  );
});

test("it judges a path the way the router routes it", () => {
  refused(
    [
      ["GET", "//v2/me"],
      ["GET", "/V2/ME"],
      ["GET", "/v2/me/"],
      ["GET", "/v2/%6De"],
      ["POST", "/v2/paywalls/9/source%2Daccess"],
      ["POST", "/v2/me;/v2/charts/data"],
      ["GET", "https://api.superwall.com/v2/me"],
      ["GET", "/v2/%E0"],
    ],
    false,
  );
  allowed(
    [
      ["GET", "/V2//Projects/"],
      ["GET", "https://api.superwall.com/v2/projects?x=%E0"],
    ],
    false,
  );
});

test("tied to one app, it reaches that app's routes", () => {
  allowed(
    [
      ["GET", "/v2/campaigns/3"],
      ["POST", "/v2/campaigns/3/audiences"],
      ["PATCH", "/v2/surveys/5"],
      ["GET", "/v2/users/abc/events"],
      ["POST", "/v2/users/query"],
      ["GET", "/v3/users/abc/subscriptions"],
      ["POST", "/v2/charts/data"],
      ["GET", "/v2/charts/definitions"],
      ["GET", "/v2/applications/42/dashboard_pins"],
      ["GET", "/v2/paywalls"],
      ["GET", "/v2/paywalls/9/preview-images"],
      ["PATCH", "/v2/paywalls/9"],
      ["POST", "/v2/paywalls/9/duplicate"],
      ["GET", "/v2/products/7"],
      ["GET", "/v2/products/7/delete-impact"],
      ["POST", "/v2/entitlements/4/grants"],
      ["DELETE", "/v2/entitlements/4/grants/9"],
      ["GET", "/v2/assets/11"],
      ["DELETE", "/v2/assets/11"],
      ["POST", "/v2/assets/upload-url"],
      ["GET", "/v2/retention-onboarding/status"],
      ["POST", "/v2/demand-score/query"],
    ],
    true,
  );
});

test("tied to one app, nothing that shows the organization or a sibling app", () => {
  refused(
    [
      ["POST", "/v2/organizations/7/query"],
      ["GET", "/v2/projects"],
      ["GET", "/v2/projects/12"],
      ["GET", "/v2/products"],
      ["GET", "/v2/entitlements"],
      ["GET", "/v2/assets"],
      ["POST", "/v2/assets/discover"],
      ["GET", "/v2/grants"],
      ["PATCH", "/v2/projects/1/custom-stores/2"],
      ["POST", "/v2/custom-stores/5/events"],
      ["POST", "/v2/paywalls"],
      ["POST", "/v2/assets"],
      ["POST", "/v2/entitlements"],
      ["POST", "/v2/products"],
      ["PATCH", "/v2/products/7"],
      ["GET", "/v2/products/app-store-connect"],
      ["GET", "/v2/products/google-play"],
      ["GET", "/v2/products/store-products"],
      ["POST", "/v2/products/store-products/import"],
      ["GET", "/v2/products/store-product-prices"],
      ["POST", "/v2/paywalls/templates/3"],
      ["POST", "/v2/paywalls/9/source-access"],
      ["GET", "/v2/me"],
      ["POST", "/v2/users/abc/attributes"],
      ["POST", "/v2/applications/1/dashboard_pins/preview"],
      ["POST", "/v2/demand-score/ai-report"],
    ],
    true,
  );
});
