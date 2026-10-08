import assert from "node:assert/strict";
import { test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import {
  planServerNotifications,
  readServerNotifications,
  setServerNotifications,
} from "@/core/api/asc-notifications";

const OURS = "https://integrations.superwall.com/integrations/app-store-connect/webhook?pk=pk_1";

test("an app with no URL gets both environments set", () => {
  assert.deepEqual(planServerNotifications({}, OURS), {
    status: "set",
    production: true,
    sandbox: true,
  });
});

test("only the empty environment is filled when the other is already ours", () => {
  assert.deepEqual(planServerNotifications({ production: OURS }, OURS), {
    status: "set",
    production: false,
    sandbox: true,
  });
});

test("both environments already ours is nothing to do", () => {
  assert.deepEqual(planServerNotifications({ production: OURS, sandbox: OURS }, OURS), {
    status: "already-set",
  });
});

test("any other URL in either environment is a conflict", () => {
  const legacy = "https://superwall.com/api/integrations/app-store-connect/webhook?pk=pk_1";
  for (const existing of [
    { production: "https://api.revenuecat.com/v1/incoming-webhooks/apple" },
    { sandbox: legacy },
    { production: OURS, sandbox: legacy },
  ]) {
    assert.deepEqual(planServerNotifications(existing, OURS), { status: "conflict", existing });
  }
});

function proxy(reply: unknown) {
  const seen: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    org: { id: "9" },
    get: async (path: string) => (seen.push({ method: "GET", path }), reply),
    patch: async (path: string, body: unknown) => (seen.push({ method: "PATCH", path, body }), {}),
  } as unknown as SuperwallApi;
  return { api, seen };
}

test("reads both URLs through the proxy, treating blanks as unset", async () => {
  const { api, seen } = proxy({
    data: {
      attributes: { subscriptionStatusUrl: " https://x.test/hook ", subscriptionStatusUrlForSandbox: "" },
    },
  });
  assert.deepEqual(await readServerNotifications(api, "TEAM", "123"), {
    production: "https://x.test/hook",
    sandbox: undefined,
  });
  assert.equal(
    seen[0]?.path,
    "/v2/organizations/9/app-store-connect/proxy/TEAM/v1/apps/123?fields[apps]=subscriptionStatusUrl,subscriptionStatusUrlVersion,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersionForSandbox",
  );
  assert.deepEqual(await readServerNotifications(proxy({}).api, "TEAM", "123"), {
    production: undefined,
    sandbox: undefined,
  });
});

test("writes only the planned environments, as version 2", async () => {
  const { api, seen } = proxy({});
  await setServerNotifications(api, "TEAM", "123", OURS, { production: true, sandbox: true });
  await setServerNotifications(api, "TEAM", "123", OURS, { production: false, sandbox: true });
  assert.deepEqual(seen[0], {
    method: "PATCH",
    path: "/v2/organizations/9/app-store-connect/proxy/TEAM/v1/apps/123",
    body: {
      data: {
        type: "apps",
        id: "123",
        attributes: {
          subscriptionStatusUrl: OURS,
          subscriptionStatusUrlVersion: "V2",
          subscriptionStatusUrlForSandbox: OURS,
          subscriptionStatusUrlVersionForSandbox: "V2",
        },
      },
    },
  });
  assert.deepEqual((seen[1]?.body as { data: { attributes: unknown } }).data.attributes, {
    subscriptionStatusUrlForSandbox: OURS,
    subscriptionStatusUrlVersionForSandbox: "V2",
  });
});
