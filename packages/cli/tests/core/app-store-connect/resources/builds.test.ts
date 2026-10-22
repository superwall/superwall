import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as builds } from "@/commands/app-store-connect/release/builds";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { APP_BY_BUNDLE, BUILD_ID, VERSION_BY_STRING, VERSION_ID } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const FIELDS = "fields[builds]=version,uploadedDate,expirationDate,expired,minOsVersion,processingState,usesNonExemptEncryption,preReleaseVersion";
const LIST = (filters: string, limit = 20) =>
  `GET /v1/builds?filter[app]=555${filters}&sort=-uploadedDate&include=preReleaseVersion&${FIELDS}&fields[preReleaseVersions]=version,platform&limit=${limit}`;
const READ = `GET /v1/builds/${BUILD_ID}?include=preReleaseVersion,appStoreVersion&${FIELDS},appStoreVersion&fields[preReleaseVersions]=version,platform&fields[appStoreVersions]=platform,versionString,appVersionState`;

const build = one(
  "builds",
  BUILD_ID,
  { version: "33", uploadedDate: "2026-09-30", expirationDate: "2026-12-29", expired: false, minOsVersion: "17.0", processingState: "VALID", usesNonExemptEncryption: false },
  { preReleaseVersion: link("preReleaseVersions", "PRE1"), appStoreVersion: link("appStoreVersions", VERSION_ID) },
);
const prerelease = one("preReleaseVersions", "PRE1", { version: "1.2.0", platform: "IOS" });

test("list reads the newest builds with their app version, filtered the way Apple filters", async () => {
  const { api } = ascRoutes({
    [APP_BY_BUNDLE]: page([one("apps", "555")]),
    [LIST("")]: page([build, one("builds", "B2", { expired: true })], { included: [prerelease] }),
    [LIST("&filter[preReleaseVersion.version]=1.2.0&filter[version]=33&filter[processingState]=VALID&filter[preReleaseVersion.platform]=IOS", 5)]: page([]),
  });
  const result = await runCommand(builds, { api, words: ["list", "com.acme.app"], json: true });
  assert.deepEqual(result.json, [
    {
      id: BUILD_ID,
      version: "33",
      versionString: "1.2.0",
      platform: "IOS",
      processingState: "VALID",
      uploadedDate: "2026-09-30",
      expirationDate: "2026-12-29",
      expired: false,
      minOsVersion: "17.0",
    },
    { id: "B2", expired: true },
  ]);
  const human = await runCommand(builds, { api, words: ["list", "555"] });
  assert.deepEqual(human.said("info"), [`\`1.2.0 (33)\`  VALID  2026-09-30  ${BUILD_ID}`, "`? (?)`  expired  B2"]);
  const filtered = await runCommand(builds, {
    api,
    words: ["list", "555"],
    flags: { versionString: "1.2.0", version: "33", processingState: "valid", platform: "IOS", limit: "5" },
    json: true,
  });
  assert.deepEqual(filtered.json, []);
});

test("list takes a limit from 1 to 200", async () => {
  const { api, sent } = ascRoutes({});
  for (const limit of ["0", "201", "1.5"]) {
    const result = await runCommand(builds, { api, words: ["list", "555"], flags: { limit } });
    assert.deepEqual(result.said("error"), ["--limit takes a whole number from 1 to 200."]);
  }
  assert.deepEqual(sent, []);
});

test("get shows the build and the version it is attached to", async () => {
  const { api } = ascRoutes({
    [READ]: { data: build, included: [prerelease, one("appStoreVersions", VERSION_ID, { versionString: "1.2.0", appVersionState: "WAITING_FOR_REVIEW" })] },
  });
  const result = await runCommand(builds, { api, words: ["get", BUILD_ID], json: true });
  assert.deepEqual(result.json, {
    id: BUILD_ID,
    version: "33",
    versionString: "1.2.0",
    platform: "IOS",
    processingState: "VALID",
    uploadedDate: "2026-09-30",
    expirationDate: "2026-12-29",
    expired: false,
    minOsVersion: "17.0",
    usesNonExemptEncryption: false,
    appStoreVersion: { id: VERSION_ID, versionString: "1.2.0", appVersionState: "WAITING_FOR_REVIEW" },
  });
});

test("get of a lone build, or of none", async () => {
  const { api } = ascRoutes({ [READ]: { data: one("builds", BUILD_ID) } });
  assert.deepEqual((await runCommand(builds, { api, words: ["get", BUILD_ID], json: true })).json, { id: BUILD_ID, appStoreVersion: null });
  const missing = ascRoutes({ [READ]: { data: null } });
  assert.deepEqual((await runCommand(builds, { api: missing.api, words: ["get", BUILD_ID] })).said("error"), [`No build ${BUILD_ID}.`]);
});

test("attach sets the version's build relationship, finding the version by its string", async () => {
  const { api, writes } = ascRoutes({
    [APP_BY_BUNDLE]: page([one("apps", "555")]),
    [VERSION_BY_STRING()]: page([one("appStoreVersions", VERSION_ID)]),
    [`PATCH /v1/appStoreVersions/${VERSION_ID}/relationships/build`]: undefined,
  });
  const result = await runCommand(builds, { api, words: ["attach", BUILD_ID, "1.2.0"], flags: { ascApp: "com.acme.app" } });
  assert.deepEqual(writes(), [{ method: "PATCH", path: `/v1/appStoreVersions/${VERSION_ID}/relationships/build`, body: { data: { type: "builds", id: BUILD_ID } } }]);
  assert.deepEqual(result.said("success"), [`Attached build ${BUILD_ID} to version ${VERSION_ID}`]);
});

test("expire confirms, then marks the build expired", async () => {
  const { api, writes } = ascRoutes({ [`PATCH /v1/builds/${BUILD_ID}`]: { data: one("builds", BUILD_ID, { expired: true }) } });
  const refused = await runCommand(builds, { api, words: ["expire", BUILD_ID] });
  assert.deepEqual(refused.said("error"), [`Expire build ${BUILD_ID}: testers can no longer install it, and no version can use it\nNothing was changed. Pass --yes to go ahead.`]);
  const planned = await runCommand(builds, { api, words: ["expire", BUILD_ID], flags: { dryRun: true }, json: true });
  assert.equal((planned.json as { requests: unknown[] }).requests.length, 1);
  assert.deepEqual(writes(), []);
  await runCommand(builds, { api, words: ["expire", BUILD_ID], flags: { yes: true } });
  assert.deepEqual(writes(), [{ method: "PATCH", path: `/v1/builds/${BUILD_ID}`, body: { data: { type: "builds", id: BUILD_ID, attributes: { expired: true } } } }]);
});
