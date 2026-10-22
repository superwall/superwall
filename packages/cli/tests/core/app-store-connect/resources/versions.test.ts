import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as versions } from "@/commands/app-store-connect/release/versions";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { APP_BY_BUNDLE, appVersion, BUILD_ID, VERSION_BY_STRING, VERSION_FIELDS, VERSION_ID, VERSION_READ } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const LIST = `GET /v1/apps/555/appStoreVersions?fields[appStoreVersions]=${VERSION_FIELDS}&limit=200`;
const GET_INCLUDES = ["build", "appStoreVersionLocalizations", "appStoreVersionPhasedRelease"];

test("list pages through the app's versions, with Apple's filters", async () => {
  const { api, sent } = ascRoutes({
    [APP_BY_BUNDLE]: page([one("apps", "555")]),
    [LIST]: page([appVersion({ appVersionState: "READY_FOR_DISTRIBUTION", createdDate: "2026-09-30" })], { next: "/v1/apps/555/appStoreVersions?cursor=2" }),
    "GET /v1/apps/555/appStoreVersions?cursor=2": page([appVersion({ versionString: "1.1.0" }, {}, "v-old")]),
    [`GET /v1/apps/555/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.0&filter[appVersionState]=IN_REVIEW&fields[appStoreVersions]=${VERSION_FIELDS}&limit=200`]: page([]),
  });
  const result = await runCommand(versions, { api, words: ["list", "com.acme.app"], json: true });
  assert.deepEqual(result.json, [
    { id: VERSION_ID, versionString: "1.2.0", platform: "IOS", appVersionState: "READY_FOR_DISTRIBUTION", releaseType: "MANUAL", createdDate: "2026-09-30" },
    { id: "v-old", versionString: "1.1.0", platform: "IOS", appVersionState: "PREPARE_FOR_SUBMISSION", releaseType: "MANUAL" },
  ]);
  const human = await runCommand(versions, { api, words: ["list", "555"] });
  assert.deepEqual(human.said("info"), [`\`1.2.0\`  IOS  READY_FOR_DISTRIBUTION  MANUAL  ${VERSION_ID}`, "`1.1.0`  IOS  PREPARE_FOR_SUBMISSION  MANUAL  v-old"]);
  await runCommand(versions, { api, words: ["list", "555"], flags: { platform: "ios", versionString: "1.2.0", appVersionState: "in-review" } });
  assert.equal(sent.at(-1)?.path.includes("filter[appVersionState]=IN_REVIEW"), true);
});

test("get reads the version with its build, localizations and phased release", async () => {
  const { api } = ascRoutes({
    [VERSION_READ(GET_INCLUDES)]: {
      data: appVersion({ copyright: "2026 Acme" }, {
        build: link("builds", BUILD_ID),
        appStoreVersionPhasedRelease: link("appStoreVersionPhasedReleases", "PR1"),
      }),
      included: [
        one("builds", BUILD_ID, { version: "33", processingState: "VALID", uploadedDate: "2026-09-30" }),
        one("appStoreVersionLocalizations", "L1", { locale: "en-US", whatsNew: "Faster" }),
        one("appStoreVersionLocalizations", "L2", { locale: "de-DE" }),
        one("appStoreVersionPhasedReleases", "PR1", { phasedReleaseState: "ACTIVE", currentDayNumber: 3, totalPauseDuration: 0, startDate: "2026-10-01" }),
      ],
    },
  });
  const result = await runCommand(versions, { api, words: ["get", VERSION_ID], json: true });
  assert.deepEqual(result.json, {
    id: VERSION_ID,
    versionString: "1.2.0",
    platform: "IOS",
    appVersionState: "PREPARE_FOR_SUBMISSION",
    releaseType: "MANUAL",
    copyright: "2026 Acme",
    build: { id: BUILD_ID, version: "33", processingState: "VALID", uploadedDate: "2026-09-30" },
    localizations: [
      { id: "L1", locale: "en-US", whatsNew: "Faster" },
      { id: "L2", locale: "de-DE" },
    ],
    phasedRelease: { id: "PR1", phasedReleaseState: "ACTIVE", startDate: "2026-10-01", currentDayNumber: 3, totalPauseDuration: 0 },
  });
});

test("a version string is found through the app, on its platform", async () => {
  const { api, sent } = ascRoutes({
    [APP_BY_BUNDLE]: page([one("apps", "555")]),
    [VERSION_BY_STRING("1.2.0", "MAC_OS")]: page([one("appStoreVersions", VERSION_ID)]),
    [VERSION_BY_STRING("9.9.9")]: page([]),
    [VERSION_READ(GET_INCLUDES)]: { data: appVersion() },
  });
  const found = await runCommand(versions, { api, words: ["get", "1.2.0"], flags: { ascApp: "com.acme.app", platform: "MAC_OS" }, json: true });
  assert.deepEqual(found.json, { ...appVersion().attributes, id: VERSION_ID, build: null, localizations: [], phasedRelease: null });
  assert.equal(sent.length, 3);
  const missing = await runCommand(versions, { api, words: ["get", "9.9.9"], flags: { ascApp: "555" } });
  assert.deepEqual(missing.said("error"), ["App 555 has no IOS version 9.9.9."]);
  const noApp = await runCommand(versions, { api, words: ["get", "1.2.0"] });
  assert.deepEqual(noApp.said("error"), ['To find version "1.2.0" by its version string, pass --asc-app <id|bundle id>, or pass the version\'s id.']);
});

test("an unknown version id says so", async () => {
  const { api } = ascRoutes({ [VERSION_READ(GET_INCLUDES)]: { data: null } });
  const result = await runCommand(versions, { api, words: ["get", VERSION_ID] });
  assert.deepEqual(result.said("error"), [`No App Store version ${VERSION_ID}.`]);
});

test("create posts the version for the app, IOS unless told otherwise", async () => {
  const { api, writes } = ascRoutes({
    [APP_BY_BUNDLE]: page([one("apps", "555")]),
    "POST /v1/appStoreVersions": { data: appVersion() },
  });
  const result = await runCommand(versions, {
    api,
    words: ["create"],
    flags: { ascApp: "com.acme.app", versionString: "1.2.0", releaseType: "scheduled", earliestReleaseDate: "2026-11-01T08:00:00-07:00", copyright: "2026 Acme" },
  });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/appStoreVersions",
      body: {
        data: {
          type: "appStoreVersions",
          attributes: { platform: "IOS", versionString: "1.2.0", releaseType: "SCHEDULED", earliestReleaseDate: "2026-11-01T08:00:00-07:00", copyright: "2026 Acme" },
          relationships: { app: link("apps", "555") },
        },
      },
    },
  ]);
  assert.deepEqual(result.said("success"), ["Created IOS version 1.2.0 (PREPARE_FOR_SUBMISSION)"]);
});

test("create plans the post on a dry run, and refuses a release date without SCHEDULED", async () => {
  const { api, writes } = ascRoutes({ "POST /v1/appStoreVersions": { data: null } });
  const planned = await runCommand(versions, { api, words: ["create"], flags: { ascApp: "555", versionString: "2.0", platform: "VISION_OS", dryRun: true }, json: true });
  assert.deepEqual(planned.json, {
    dryRun: true,
    requests: [
      {
        method: "POST",
        path: "/v1/appStoreVersions",
        body: { data: { type: "appStoreVersions", attributes: { platform: "VISION_OS", versionString: "2.0" }, relationships: { app: link("apps", "555") } } },
      },
    ],
  });
  const dateOnly = await runCommand(versions, { api, words: ["create"], flags: { ascApp: "555", versionString: "2.0", earliestReleaseDate: "2026-11-01" } });
  assert.deepEqual(dateOnly.said("error"), ["--earliest-release-date goes with --release-type SCHEDULED."]);
  const manual = await runCommand(versions, { api, words: ["update", VERSION_ID], flags: { releaseType: "MANUAL", earliestReleaseDate: "2026-11-01" } });
  assert.deepEqual(manual.said("error"), ["--earliest-release-date goes with --release-type SCHEDULED."]);
  assert.deepEqual(writes(), []);
  const none = await runCommand(versions, { api, words: ["create"], flags: { ascApp: "555", versionString: "2.0" } });
  assert.deepEqual(none.said("error"), ["Apple created no App Store version."]);
});

test("update patches only what is passed", async () => {
  const { api, writes } = ascRoutes({ [`PATCH /v1/appStoreVersions/${VERSION_ID}`]: undefined });
  const result = await runCommand(versions, { api, words: ["update", VERSION_ID], flags: { versionString: "1.2.1", earliestReleaseDate: "2026-12-01" }, json: true });
  assert.deepEqual(writes(), [
    {
      method: "PATCH",
      path: `/v1/appStoreVersions/${VERSION_ID}`,
      body: { data: { type: "appStoreVersions", id: VERSION_ID, attributes: { versionString: "1.2.1", earliestReleaseDate: "2026-12-01" } } },
    },
  ]);
  assert.deepEqual(result.json, { id: VERSION_ID, versionString: "1.2.1", earliestReleaseDate: "2026-12-01" });
  const nothing = await runCommand(versions, { api, words: ["update", VERSION_ID] });
  assert.deepEqual(nothing.said("error"), ["Nothing to change: pass --version-string, --release-type, --earliest-release-date or --copyright."]);
});

test("delete removes an editable version, after confirming", async () => {
  const { api, writes } = ascRoutes({
    [VERSION_READ()]: { data: appVersion() },
    [`DELETE /v1/appStoreVersions/${VERSION_ID}`]: undefined,
  });
  const refused = await runCommand(versions, { api, words: ["delete", VERSION_ID] });
  assert.deepEqual(refused.said("error"), ["Delete version 1.2.0\nNothing was changed. Pass --yes to go ahead."]);
  assert.deepEqual(writes(), []);
  const done = await runCommand(versions, { api, words: ["delete", VERSION_ID], flags: { yes: true } });
  assert.deepEqual(writes(), [{ method: "DELETE", path: `/v1/appStoreVersions/${VERSION_ID}` }]);
  assert.deepEqual(done.said("success"), ["Deleted version 1.2.0"]);
});

test("delete refuses a version Apple no longer lets you edit", async () => {
  const { api, writes } = ascRoutes({ [VERSION_READ()]: { data: one("appStoreVersions", VERSION_ID, { appVersionState: "READY_FOR_DISTRIBUTION" }) } });
  const result = await runCommand(versions, { api, words: ["delete", VERSION_ID], flags: { yes: true } });
  assert.deepEqual(result.said("error"), [
    `Version ${VERSION_ID} is READY_FOR_DISTRIBUTION; Apple only deletes a version while it's editable (PREPARE_FOR_SUBMISSION, DEVELOPER_REJECTED, REJECTED, METADATA_REJECTED, INVALID_BINARY).`,
  ]);
  const unknown = ascRoutes({ [VERSION_READ()]: { data: one("appStoreVersions", VERSION_ID) } });
  const stateless = await runCommand(versions, { api: unknown.api, words: ["delete", VERSION_ID], flags: { yes: true } });
  assert.match(stateless.said("error")[0] ?? "", /is in an unknown state/);
  assert.deepEqual(writes(), []);
});
