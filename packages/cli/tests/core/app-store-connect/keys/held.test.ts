import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import { command as create } from "@/commands/app-store-connect/keys/create";
import { command as update } from "@/commands/app-store-connect/keys/update";
import { runWithApi as keys, scenario } from "../../../helpers/apple-setup";

const DIR = mkdtempSync(join(tmpdir(), "superwall-held-keys-"));
const KEY_FILE = join(DIR, "AuthKey.p8");
writeFileSync(KEY_FILE, "PEM");
const HELD = { keyId: "K1", issuer: "I1", keyFile: KEY_FILE };
const NO_BUNDLE = { projects: [{ id: 5, applications: [{ id: 8, name: "Acme", platform: "ios" }] }] };

after(() => {
  rmSync(DIR, { recursive: true, force: true });
});

afterEach(() => {
  process.exitCode = undefined;
});

const orgRoutes = (answer: unknown) => (_method: string, path: string) =>
  path.startsWith("/v2/organizations/9/app-store-connect") ? answer : undefined;

interface TextPrompt {
  message: string;
  validate?: (value: string | undefined) => string | undefined;
}

function prompts(calls: Array<{ method: string; value?: unknown }>): TextPrompt[] {
  return calls.filter((call) => call.method === "text").map((call) => call.value as TextPrompt);
}

test("an organization key is planned under --dry-run, with the team when one is named", async () => {
  const human = await keys(create, { flags: { ...HELD, dryRun: true } });
  assert.deepEqual(human.said("info"), [`[dry-run] would upload ASC key K1 (issuer I1) from ${KEY_FILE}`]);
  assert.equal(human.requests.length, 0);

  const planned = await keys(update, { json: true, flags: { ...HELD, team: "TEAM1", dryRun: true } });
  assert.deepEqual(planned.json(), {
    dryRun: true,
    action: "update",
    keyId: "K1",
    issuerId: "I1",
    keyFile: KEY_FILE,
    teamId: "TEAM1",
  });
});

test("connecting an organization key names the team, or the credential when Apple has no team id", async () => {
  const team = await keys(create, { flags: { ...HELD, name: "Acme ASC" } }, { routes: orgRoutes({ team_id: "TEAM1" }) });
  assert.deepEqual(team.said("success"), ["App Store Connect connected TEAM1"]);
  assert.equal((team.wrote("POST", "/app-store-connect")[0]?.body as { account_name: string }).account_name, "Acme ASC");

  const byId = await keys(create, { flags: HELD }, { routes: orgRoutes({ id: "cfg-7" }) });
  assert.deepEqual(byId.said("success"), ["App Store Connect connected cfg-7"]);

  const neither = await keys(create, { flags: HELD }, { routes: orgRoutes({}) });
  assert.deepEqual(neither.said("success"), ["App Store Connect connected "]);
});

test("without prompts an organization key needs every part, and the key file must exist", async () => {
  const createUsage = await keys(create, { flags: { keyFile: KEY_FILE } });
  assert.deepEqual(createUsage.said("error"), [
    "Usage: superwall asc keys create --key-id <id> --issuer <id> --key-file <path.p8> [--name <name>]",
  ]);

  const updateUsage = await keys(update, { flags: { team: "TEAM1", keyId: "K1" } });
  assert.deepEqual(updateUsage.said("error"), [
    "Usage: superwall asc keys update --key-id <id> --issuer <id> --key-file <path.p8> --team <id>",
  ]);

  const missing = join(DIR, "missing.p8");
  const absent = await keys(create, { flags: { ...HELD, keyFile: missing } });
  assert.deepEqual(absent.said("error"), [`Couldn't find the .p8 key file at ${missing}`]);
  assert.equal(absent.requests.length, 0);
});

test("prompts for each missing part of an organization key, then replaces the team's key", async () => {
  const run = await scenario(update, {
    interactive: true,
    flags: { team: "TEAM9" },
    answers: { text: [" K9 ", " I9 ", ` ${KEY_FILE} `, " Studio "] },
    api: { routes: orgRoutes({ team_id: "TEAM9" }) },
  });

  const asked = prompts(run.calls);
  assert.deepEqual(
    asked.map((prompt) => prompt.message),
    ["Key ID", "Issuer ID", "Path to the .p8 key file", "Name (optional)"],
  );
  assert.deepEqual(run.calls.find((call) => call.method === "note")?.value, {
    value:
      "Create a key in App Store Connect → Users and Access → Integrations →\nApp Store Connect API. You'll need its Key ID, the Issuer ID, and the\ndownloaded .p8 file. This is stored org-wide for the signed proxy.",
    title: "Connect App Store Connect",
  });
  assert.equal(asked[0]?.validate?.("  "), "Required");
  assert.equal(asked[0]?.validate?.("K9"), undefined);
  assert.equal(asked[1]?.validate?.(undefined), "Required");
  assert.equal(asked[1]?.validate?.("I9"), undefined);
  assert.equal(asked[2]?.validate?.(""), "Required");
  assert.equal(asked[2]?.validate?.(undefined), "Required");
  assert.equal(asked[2]?.validate?.(join(DIR, "nope.p8")), "No file at that path");
  assert.equal(asked[2]?.validate?.(` ${KEY_FILE} `), undefined);
  assert.deepEqual(run.wrote("PATCH", "/app-store-connect/TEAM9")[0]?.body, {
    key_id: "K9",
    issuer_id: "I9",
    private_key: "PEM",
    account_name: "Studio",
    validate: true,
  });
  assert.deepEqual(run.said("success"), ["App Store Connect connected TEAM9"]);
});

test("a blank name at the prompt falls back to the default account name", async () => {
  const run = await scenario(create, {
    interactive: true,
    flags: { issuer: "I1", keyFile: KEY_FILE },
    answers: { text: ["K1", ""] },
    api: { routes: orgRoutes({ team_id: "TEAM1" }) },
  });

  assert.deepEqual(
    prompts(run.calls).map((prompt) => prompt.message),
    ["Key ID", "Name (optional)"],
  );
  assert.equal(
    (run.wrote("POST", "/app-store-connect")[0]?.body as { account_name: string }).account_name,
    "App Store Connect",
  );
});

test("cancelling any prompt stops without saving anything", async () => {
  for (const answered of [0, 1, 2, 3]) {
    const answers = [" K9 ", " I9 ", KEY_FILE].slice(0, answered);
    const run = await scenario(update, {
      interactive: true,
      flags: { team: "TEAM9" },
      answers: { text: [...answers, null] },
      api: { routes: orgRoutes({ team_id: "TEAM9" }) },
    });
    assert.deepEqual(run.said("warn"), ["Cancelled."], `after ${answered} answers`);
    assert.equal(run.requests.length, 0, `after ${answered} answers`);
  }
});

test("nothing is asked when every part of the key was passed", async () => {
  const run = await scenario(update, {
    interactive: true,
    flags: { team: "TEAM1", ...HELD },
    api: { routes: orgRoutes({ team_id: "TEAM1" }) },
  });

  assert.deepEqual(prompts(run.calls), []);
  assert.equal(run.calls.some((call) => call.method === "note"), false);
  assert.deepEqual(run.said("success"), ["App Store Connect connected TEAM1"]);
});

test("an app key asks only for the key itself, with the app's wording", async () => {
  const run = await scenario(create, {
    interactive: true,
    args: { kind: "api_key" },
    flags: { app: "8", keyFile: KEY_FILE },
    answers: { text: ["K2", "I2"] },
  });

  assert.deepEqual(
    prompts(run.calls).map((prompt) => prompt.message),
    ["Key ID", "Issuer ID"],
  );
  assert.equal(
    (run.calls.find((call) => call.method === "note")?.value as { title: string }).title,
    "Save an Apple key on the app",
  );
  assert.deepEqual(run.said("success"), ["App Store Connect API key K2 saved on `Acme`."]);
});

test("planning a purchase key that brings the app its bundle ID says so", async () => {
  const flags = { app: "8", bundleId: "com.acme.app", dryRun: true, ...HELD };
  const human = await keys(create, { args: { kind: "purchase_key" }, flags }, NO_BUNDLE);
  assert.deepEqual(human.said("info"), [
    "[dry-run] would save In-App Purchase key K1 and its bundle ID com.acme.app on Acme",
  ]);

  const json = await keys(create, { json: true, args: { kind: "purchase_key" }, flags }, NO_BUNDLE);
  assert.deepEqual(json.json(), {
    dryRun: true,
    action: "create",
    kind: "purchase_key",
    application_id: "8",
    keyId: "K1",
    bundle_id: "com.acme.app",
    set_application_bundle_id: true,
  });

  const saved = await keys(create, { args: { kind: "purchase_key" }, flags: { app: "8", dryRun: true, ...HELD } });
  assert.deepEqual(saved.said("info"), ["[dry-run] would save In-App Purchase key K1 on Acme"]);
});

test("a key Apple refuses without a reason still exits non-zero", async () => {
  const run = await keys(create, { flags: { app: "8", ...HELD } }, { appVerdicts: [{ valid: false, error: null }] });

  assert.deepEqual(run.said("error"), ["Apple didn't accept App Store Connect API key K1."]);
  assert.equal(process.exitCode, 1);
});
