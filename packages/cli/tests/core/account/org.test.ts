import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SuperwallApi } from "@/core/api/client";
import { requireOrg } from "@/core/account/org";
import type { Session } from "@/core/auth/storage";

// Keep setOrg's saveSession away from the real ~/.superwall.
process.env.HOME = mkdtempSync(join(tmpdir(), "sw-org-test-"));

function apiWithOrgs(
  orgs: Array<{ id: number; name: string }> | null,
  session: Partial<Session> = {},
): SuperwallApi {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: orgs }), {
      status: 200,
    })) as typeof fetch;
  return SuperwallApi.of({
    apiKey: "sk_x",
    host: "https://api.example.com",
    createdAt: "n",
    ...session,
  });
}

test("requireOrg returns the session org without fetching", async () => {
  globalThis.fetch = (async () => {
    throw new Error("should not fetch");
  }) as typeof fetch;
  const api = SuperwallApi.of({
    apiKey: "sk_x",
    orgId: "42",
    orgName: "Acme",
    host: "https://api.example.com",
    createdAt: "n",
  });
  assert.deepEqual(await requireOrg(api, false), { id: "42", name: "Acme" });
});

test("requireOrg auto-picks and persists a sole org", async () => {
  const api = apiWithOrgs([{ id: 7, name: "Solo Inc" }]);
  const org = await requireOrg(api, false);
  assert.deepEqual(org, { id: "7", name: "Solo Inc" });
  assert.equal(api.org.id, "7");
});

test("requireOrg with multiple orgs and no prompt points at orgs use", async () => {
  const api = apiWithOrgs([
    { id: 1, name: "A" },
    { id: 2, name: "B" },
  ]);
  await assert.rejects(() => requireOrg(api, false), /orgs use/);
  assert.equal(api.org.id, undefined);
});

test("requireOrg with no orgs points at login", async () => {
  const api = apiWithOrgs([]);
  await assert.rejects(() => requireOrg(api, false), /superwall login/);
});
