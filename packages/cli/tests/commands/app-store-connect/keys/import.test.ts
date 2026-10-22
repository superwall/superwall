import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as importKeys } from "@/commands/app-store-connect/keys/import";
import { runWithApi as keys } from "../../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const INTEGRATIONS = "/internal/v2/applications/8/integrations";

test("keys import tries both kinds and exits non-zero when one is still missing", async () => {
  const results: Record<string, unknown> = {
    api_key: {
      kind: "api_key",
      status: "imported",
      key_id: "APIKEY0001",
      source_name: "Other App",
      source_application_id: "12",
      tried: 2,
      timed_out: false,
    },
    purchase_key: {
      kind: "purchase_key",
      status: "not_found",
      key_id: null,
      source_name: null,
      source_application_id: null,
      tried: 0,
      timed_out: false,
    },
  };
  const routes = (method: string, path: string, body?: unknown) =>
    method === "POST" && path === `${INTEGRATIONS}/app-store-keys/import`
      ? results[(body as { kind: string }).kind]
      : undefined;
  const json = await keys(importKeys, { json: true, flags: { app: "8" } }, { routes });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(
    (json.json() as { results: Array<{ kind: string; status: string }> }).results.map(
      (result) => [result.kind, result.status],
    ),
    [
      ["api_key", "imported"],
      ["purchase_key", "not_found"],
    ],
  );

  process.exitCode = undefined;
  const one = await keys(importKeys, { args: { kind: "api_key" }, flags: { app: "8" } }, { routes });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(one.said("report"), [
    "✓ App Store Connect API key APIKEY0001 imported to Acme from Other App.",
  ]);
  assert.equal(one.wrote("POST", "/app-store-keys/import").length, 1);
});

test("keys import words each way of finding nothing", async () => {
  const answer = (extra: Record<string, unknown>) => ({
    routes: (method: string, path: string) =>
      method === "POST" && path.endsWith("/app-store-keys/import")
        ? {
            kind: "purchase_key",
            status: "not_found",
            key_id: null,
            source_name: null,
            source_application_id: null,
            tried: 3,
            timed_out: false,
            ...extra,
          }
        : undefined,
  });
  const input = { args: { kind: "purchase_key" }, flags: { app: "8" } };
  const none = await keys(importKeys, input, answer({}));
  assert.match(none.said("report")[0] ?? "", /None of your organization's 3 saved In-App Purchase keys is confirmed/);
  const empty = await keys(importKeys, input, answer({ tried: 0 }));
  assert.match(empty.said("report")[0] ?? "", /has no In-App Purchase key to try on Acme/);
  const slow = await keys(importKeys, input, answer({ timed_out: true }));
  assert.match(slow.said("report")[0] ?? "", /ran out of time \(3 tried\)/);
  process.exitCode = undefined;
  const kept = await keys(importKeys, input, answer({ status: "already_saved", key_id: "IAP1" }));
  assert.equal(process.exitCode, undefined);
  assert.match(kept.said("report")[0] ?? "", /✓ Acme already has an In-App Purchase key \(IAP1\)/);

  const bad = await keys(importKeys, { args: { kind: "team" }, flags: { app: "8" } });
  assert.deepEqual(bad.said("error"), ['<kind> is one of: api_key, purchase_key (not "team").']);
});

test("keys import --from saves a confirmed key and refuses an unconfirmed one without the flag", async () => {
  const bodies: unknown[] = [];
  const routes = (method: string, path: string, body?: unknown) => {
    if (method !== "POST" || !path.endsWith("/app-store-keys/copy")) return undefined;
    bodies.push(body);
    const confirmed = (body as { confirmed?: boolean }).confirmed === true;
    return confirmed
      ? { kind: "api_key", valid: true, error: null, unconfirmed: null }
      : { kind: "api_key", valid: false, error: null, unconfirmed: "This team has no app com.acme.app." };
  };
  const input = { args: { kind: "api_key" }, flags: { app: "8", from: 12 } };

  const refused = await keys(importKeys, input, { routes });
  assert.equal(process.exitCode, 1);
  assert.match(refused.said("error")[0] ?? "", /This team has no app com\.acme\.app\./);
  assert.match(refused.said("error")[0] ?? "", /Nothing was saved\. Pass --allow-unconfirmed/);
  assert.deepEqual(bodies, [{ kind: "api_key", source_application_id: "12" }]);

  process.exitCode = undefined;
  const allowed = await keys(importKeys, { ...input, json: true, flags: { ...input.flags, allowUnconfirmed: true } }, { routes });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(allowed.json(), {
    application_id: "8",
    kind: "api_key",
    from: "12",
    valid: true,
    error: null,
    unconfirmed: null,
  });

  bodies.length = 0;
  const asked = await keys(importKeys, input, { routes, interactive: true, confirm: true });
  assert.deepEqual(asked.said("success"), ["App Store Connect API key copied to `Acme`."]);
  assert.deepEqual(bodies, [
    { kind: "api_key", source_application_id: "12" },
    { kind: "api_key", source_application_id: "12", confirmed: true },
  ]);

  bodies.length = 0;
  await keys(importKeys, input, { routes, interactive: true, confirm: false });
  assert.equal(process.exitCode, 1);
  assert.equal(bodies.length, 1);
});

test("keys import --from reports a key that no longer works, and needs a kind", async () => {
  const dead = await keys(importKeys, { args: { kind: "purchase_key" }, flags: { app: "8", from: "12" } },
    {
      routes: (_method, path) =>
        path.endsWith("/app-store-keys/copy")
          ? { kind: "purchase_key", valid: false, error: "Apple rejected this key.", unconfirmed: null }
          : undefined,
    },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(dead.said("error"), ["Apple rejected this key.\nNothing was saved."]);

  const noKind = await keys(importKeys, { flags: { app: "8", from: "12" } });
  assert.match(noKind.said("error")[0] ?? "", /Usage: superwall asc keys import <api_key \| purchase_key>/);
});

test("--dry-run plans an import without making it", async () => {
  for (const input of [
    { args: { kind: "api_key" }, flags: { app: "8", from: "12", dryRun: true } },
    { flags: { app: "8", dryRun: true } },
  ]) {
    const human = await keys(importKeys, input);
    assert.match(human.said("info")[0] ?? "", /^\[dry-run\] would /);
    assert.equal(human.requests.length, 0);
    const json = await keys(importKeys, { ...input, json: true });
    assert.equal((json.json() as { dryRun: boolean }).dryRun, true);
  }
});
