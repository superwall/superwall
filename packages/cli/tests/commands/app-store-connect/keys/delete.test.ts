import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as remove } from "@/commands/app-store-connect/keys/delete";
import { runWithApi as keys } from "../../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const INTEGRATIONS = "/internal/v2/applications/8/integrations";

test("keys delete --app removes one kind from the app and says what is untouched", async () => {
  const routes = (method: string) => (method === "DELETE" ? { kind: "purchase_key" } : undefined);
  const run1 = await keys(remove, { args: { key: "purchase_key" }, flags: { app: "8" } }, { routes });
  assert.deepEqual(
    run1.wrote("DELETE", "").map((request) => request.path),
    [`${INTEGRATIONS}/app-store-keys/purchase_key`],
  );
  assert.match(run1.said("success")[0] ?? "", /Nothing was revoked at Apple/);
  const json = await keys(remove, { json: true, args: { key: "api_key" }, flags: { app: "8" } }, { routes });
  assert.deepEqual(json.json(), { deleted: true, kind: "api_key", application_id: "8" });
  const usage = await keys(remove, { flags: { app: "8" } });
  assert.match(usage.said("error")[0] ?? "", /Usage: superwall asc keys delete <api_key \| purchase_key>/);
  const noApp = await keys(remove, { args: { key: "api_key" } }, { routes });
  assert.deepEqual(noApp.said("error"), ["Usage: superwall asc keys delete api_key --app <id>"]);
  assert.equal(noApp.wrote("DELETE", "").length, 0);
});

test("without --app it removes the organization's key for a team", async () => {
  const routes = (method: string) => (method === "DELETE" ? { success: true } : undefined);
  const human = await keys(remove, { args: { key: "TEAM1" } }, { routes });
  assert.deepEqual(
    human.wrote("DELETE", "").map((request) => request.path),
    ["/v2/organizations/9/app-store-connect/TEAM1"],
  );
  assert.deepEqual(human.said("success"), ["Removed App Store Connect credential TEAM1"]);
  const json = await keys(remove, { args: { key: "TEAM1" }, json: true }, { routes });
  assert.deepEqual(json.json(), { deleted: true, teamId: "TEAM1" });
  const usage = await keys(remove);
  assert.deepEqual(usage.said("error"), ["Usage: superwall asc keys delete <team_id>"]);
});

test("--dry-run plans a delete without making it", async () => {
  for (const input of [
    { args: { key: "api_key" }, flags: { app: "8", dryRun: true } },
    { args: { key: "TEAM1" }, flags: { dryRun: true } },
  ]) {
    const human = await keys(remove, input);
    assert.match(human.said("info")[0] ?? "", /^\[dry-run\] would /);
    assert.equal(human.requests.length, 0);
    const json = await keys(remove, { ...input, json: true });
    assert.equal((json.json() as { dryRun: boolean }).dryRun, true);
  }
});
