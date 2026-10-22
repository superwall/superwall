import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  readAnonymousId,
  readDefaultApp,
  readOnboardedApp,
  readOnboardedOrg,
  readOnboardingIdempotencyKey,
  readOpenedOrgs,
  readSkillsSync,
  readUpdateCheck,
  telemetryNoticeShown,
  writeDefaultApp,
  writeOnboardedApp,
  writeOnboardedOrg,
  writeOpenedOrgs,
  writeSkillsSync,
  writeTelemetryNoticeShown,
  writeUpdateCheck,
} from "@/core/state/config";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => {
  clearHomes();
});

const readConfig = (home: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));

test("a fresh home reads as empty config and writes nothing", () => {
  const home = useHome();

  assert.equal(readDefaultApp("1"), undefined);
  assert.deepEqual(readOpenedOrgs(), []);
  assert.equal(readSkillsSync(), undefined);
  assert.equal(readOnboardedOrg(), undefined);
  assert.equal(readOnboardedApp("/app"), undefined);
  assert.equal(readUpdateCheck(), undefined);
  assert.equal(telemetryNoticeShown(), false);
  assert.equal(fs.existsSync(path.join(home, "config.json")), false);
});

test("the default app is remembered per project, privately", () => {
  const home = useHome();

  writeDefaultApp("10", "100");
  writeDefaultApp("20", "200");
  writeDefaultApp("10", "101");

  assert.equal(readDefaultApp("10"), "101");
  assert.equal(readDefaultApp("20"), "200");
  assert.equal(fs.statSync(path.join(home, "config.json")).mode & 0o777, 0o600);
});

test("opened organizations are kept unique and an unchanged list is not rewritten", () => {
  const home = useHome();

  writeOpenedOrgs([]);
  assert.equal(fs.existsSync(path.join(home, "config.json")), false);

  writeOpenedOrgs(["7", "8", "7"]);
  assert.deepEqual(readOpenedOrgs(), ["7", "8"]);

  fs.utimesSync(path.join(home, "config.json"), 0, 0);
  writeOpenedOrgs(["7", "8"]);
  assert.equal(fs.statSync(path.join(home, "config.json")).mtimeMs, 0);
});

test("skills sync and the update check round-trip", () => {
  useHome();
  const sync = { cliVersion: "1.2.3", syncedAt: "2026-01-01T00:00:00.000Z", ref: "main" };

  writeSkillsSync(sync);
  writeUpdateCheck({ latest: "2.0.0", checkedAt: "2026-01-02T00:00:00.000Z" });

  assert.deepEqual(readSkillsSync(), sync);
  assert.deepEqual(readUpdateCheck(), { latest: "2.0.0", checkedAt: "2026-01-02T00:00:00.000Z" });
});

test("the anonymous id is created once and survives the telemetry notice", () => {
  const home = useHome();

  const id = readAnonymousId();
  writeTelemetryNoticeShown();

  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(readAnonymousId(), id);
  assert.equal(telemetryNoticeShown(), true);
  assert.deepEqual(readConfig(home), { telemetry: { anonymousId: id, noticeShown: true } });
});

test("the onboarding idempotency key stays the same across calls", () => {
  useHome();

  const key = readOnboardingIdempotencyKey();

  assert.match(key, /^[0-9a-f-]{36}$/);
  assert.equal(readOnboardingIdempotencyKey(), key);
});

test("the onboarded org and apps are kept side by side", () => {
  const home = useHome();

  writeOnboardedApp("/one", { publicApiKey: "pk_one", projectId: "1", applicationId: "11" });
  writeOnboardedOrg({ id: "7", name: "Acme" });
  writeOnboardedApp("/two", { publicApiKey: "pk_two" });

  assert.deepEqual(readOnboardedOrg(), { id: "7", name: "Acme" });
  assert.deepEqual(readOnboardedApp("/one"), {
    publicApiKey: "pk_one",
    projectId: "1",
    applicationId: "11",
  });
  assert.deepEqual(readConfig(home), {
    onboarded: {
      apps: {
        "/one": { publicApiKey: "pk_one", projectId: "1", applicationId: "11" },
        "/two": { publicApiKey: "pk_two" },
      },
      org: { id: "7", name: "Acme" },
    },
  });
});

test("an unreadable config counts as empty and is replaced on the next write", () => {
  const home = useHome();
  fs.writeFileSync(path.join(home, "config.json"), "{not json");

  assert.equal(readDefaultApp("1"), undefined);
  writeDefaultApp("1", "2");

  assert.deepEqual(readConfig(home), { defaultApp: { "1": "2" } });
});

test("the config directory is created when the home does not exist yet", () => {
  const home = useHome();
  const nested = path.join(home, "nested", "home");
  process.env.SUPERWALL_HOME = nested;

  writeDefaultApp("1", "2");

  assert.deepEqual(readConfig(nested), { defaultApp: { "1": "2" } });
});
