import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { command as update } from "@/commands/app-store-connect/keys/update";
import { runWithApi as keys } from "../../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const KEY_FILE = join(mkdtempSync(join(tmpdir(), "superwall-keys-")), "AuthKey.p8");
writeFileSync(KEY_FILE, "PEM");
const HELD = { keyId: "K1", issuer: "I1", keyFile: KEY_FILE };

test("replacing an organization's key asks Superwall to check the team", async () => {
  const routes = (_method: string, path: string) =>
    path.startsWith("/v2/organizations/9/app-store-connect") ? { team_id: "TEAM1" } : undefined;
  const replaced = await keys(update, { flags: { team: "TEAM1", ...HELD } }, { routes });
  assert.deepEqual(replaced.wrote("PATCH", "/app-store-connect/TEAM1")[0]?.body, {
    key_id: "K1",
    issuer_id: "I1",
    private_key: "PEM",
    validate: true,
  });
  const planned = await keys(update, { json: true, flags: { team: "TEAM1", ...HELD, dryRun: true } });
  assert.equal((planned.json() as { teamId: string }).teamId, "TEAM1");
  const noTeam = await keys(update, { flags: HELD });
  assert.match(noTeam.said("error")[0] ?? "", /^Usage: superwall asc keys update --team <team id>/);
});

test("with --app it saves the key on the app, and says what it needs", async () => {
  const saved = await keys(update, { args: { kind: "api_key" }, flags: { app: "8", ...HELD }, json: true });
  assert.deepEqual(saved.json(), { application_id: "8", kind: "api_key", key_id: "K1", valid: true, error: null });
  const usage = await keys(update, { flags: { app: "8" } });
  assert.match(usage.said("error")[0] ?? "", /asc keys update \[api_key \| purchase_key\] --app <id>/);
});
