import assert from "node:assert/strict";
import { test } from "node:test";
import { findApp, listApps } from "@/core/apple/apps";
import type { AppleSession, IrisRequest } from "@/core/apple/session";

function session(data: unknown) {
  const seen: Array<{ method: string; path: string; request?: IrisRequest }> = [];
  const fake = {
    iris: async (method: string, path: string, request?: IrisRequest) => {
      seen.push({ method, path, request });
      return { data };
    },
  } as unknown as AppleSession;
  return { session: fake, seen };
}

const APPS = [
  { id: "1", attributes: { name: "Acme", bundleId: "com.acme.app" } },
  { id: "2", attributes: { name: "Acme Pro", bundleId: "com.acme.app.pro" } },
  { attributes: { name: "No id" } },
  { id: "3" },
];

test("lists the team's apps, skipping records without an id", async () => {
  const { session: apple, seen } = session(APPS);
  assert.deepEqual(await listApps(apple), [
    { id: "1", name: "Acme", bundleId: "com.acme.app" },
    { id: "2", name: "Acme Pro", bundleId: "com.acme.app.pro" },
    { id: "3", name: undefined, bundleId: undefined },
  ]);
  assert.deepEqual(seen, [{ method: "GET", path: "/apps", request: { query: { limit: "200" } } }]);
});

test("finds an app only on an exact bundle ID match", async () => {
  const { session: apple, seen } = session(APPS.slice(1));
  assert.equal(await findApp(apple, "com.acme.app"), undefined);
  assert.deepEqual(await findApp(apple, "com.acme.app.pro"), {
    id: "2",
    name: "Acme Pro",
    bundleId: "com.acme.app.pro",
  });
  assert.deepEqual(seen[0]?.request, { query: { "filter[bundleId]": "com.acme.app", limit: "10" } });
  assert.deepEqual(await listApps(session(undefined).session), []);
});
