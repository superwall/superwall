import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as release } from "@/commands/app-store-connect/release/release";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { appVersion, BUILD_ID, VERSION_ID, VERSION_READ } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const OPEN = "GET /v1/reviewSubmissions?filter[app]=555&filter[state]=READY_FOR_REVIEW&filter[platform]=IOS&limit=1";
const SUBMITTABLE = {
  [VERSION_READ(["app", "build"])]: {
    data: appVersion({}, { app: link("apps", "555"), build: link("builds", BUILD_ID) }),
    included: [one("builds", BUILD_ID, { version: "33" })],
  },
};
const PHASED = `GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionPhasedRelease`;
const STATUS_SUBMISSIONS =
  "GET /v1/reviewSubmissions?filter[app]=555&filter[platform]=IOS&include=appStoreVersionForReview&fields[reviewSubmissions]=platform,state,submittedDate,appStoreVersionForReview&fields[appStoreVersions]=versionString&limit=50";

const item = (relationship: string, type: string, id: string) => ({
  method: "POST",
  path: "/v1/reviewSubmissionItems",
  body: { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: link("reviewSubmissions", "RS1"), [relationship]: link(type, id) } } },
});

test("submit puts the version and its first in-app products in one review submission", async () => {
  const { api, writes } = ascRoutes({
    ...SUBMITTABLE,
    "GET /v1/subscriptions/601/versions": page([one("subscriptionVersions", "SV1", { version: 1 })]),
    "GET /v2/inAppPurchases/701/versions": page([one("inAppPurchaseVersions", "IV1", { version: 1 })]),
    "GET /v1/subscriptionGroups/201/versions": page([one("subscriptionGroupVersions", "GV1", { version: 1 })]),
    [OPEN]: page([]),
    "POST /v1/reviewSubmissions": { data: one("reviewSubmissions", "RS1") },
    "POST /v1/reviewSubmissionItems": { data: one("reviewSubmissionItems", "I") },
    "PATCH /v1/reviewSubmissions/RS1": { data: one("reviewSubmissions", "RS1", { state: "WAITING_FOR_REVIEW" }) },
  });
  const result = await runCommand(release, { api, words: ["submit", VERSION_ID], flags: { subscription: ["601"], iap: "701", group: ["201"] } });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/reviewSubmissions",
      body: { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: link("apps", "555") } } },
    },
    item("appStoreVersion", "appStoreVersions", VERSION_ID),
    item("subscriptionGroupVersion", "subscriptionGroupVersions", "GV1"),
    item("subscriptionVersion", "subscriptionVersions", "SV1"),
    item("inAppPurchaseVersion", "inAppPurchaseVersions", "IV1"),
    { method: "PATCH", path: "/v1/reviewSubmissions/RS1", body: { data: { type: "reviewSubmissions", id: "RS1", attributes: { submitted: true } } } },
  ]);
  assert.deepEqual(result.said("success"), ["Submitted version 1.2.0 with 3 in-app products for review"]);
});

test("submit alone reuses the open submission; a dry run plans every write", async () => {
  const { api, writes } = ascRoutes({
    ...SUBMITTABLE,
    [OPEN]: page([one("reviewSubmissions", "RS0")]),
    "POST /v1/reviewSubmissionItems": { data: one("reviewSubmissionItems", "I") },
    "PATCH /v1/reviewSubmissions/RS0": undefined,
    "GET /v2/inAppPurchases/701/versions": page([one("inAppPurchaseVersions", "IV1", { version: 1 })]),
  });
  const result = await runCommand(release, { api, words: ["submit", VERSION_ID], json: true });
  assert.deepEqual((result.json as { reviewSubmission: unknown }).reviewSubmission, { id: "RS0", reused: true });
  assert.deepEqual(
    writes().map((request) => `${request.method} ${request.path}`),
    ["POST /v1/reviewSubmissionItems", "PATCH /v1/reviewSubmissions/RS0"],
  );
  const human = await runCommand(release, { api, words: ["submit", VERSION_ID] });
  assert.deepEqual(human.said("success"), ["Submitted version 1.2.0 for review"]);
  const sentBefore = writes().length;
  const planned = await runCommand(release, { api, words: ["submit", VERSION_ID], flags: { iap: ["701"], dryRun: true } });
  assert.deepEqual(planned.said("step"), [
    VERSION_READ(["app", "build"]),
    "GET /v2/inAppPurchases/701/versions",
    OPEN,
    "POST /v1/reviewSubmissionItems",
    "POST /v1/reviewSubmissionItems",
    "PATCH /v1/reviewSubmissions/RS0",
  ]);
  assert.equal(writes().length, sentBefore);
});

test("submit needs a build on the version, a version of each product, and the version's app", async () => {
  const noBuild = ascRoutes({ [VERSION_READ(["app", "build"])]: { data: appVersion({}, { app: link("apps", "555") }) } });
  assert.deepEqual((await runCommand(release, { api: noBuild.api, words: ["submit", VERSION_ID] })).said("error"), [
    `Version 1.2.0 has no build. Attach one first: asc builds attach <build> ${VERSION_ID}.`,
  ]);
  const noProductVersion = ascRoutes({ ...SUBMITTABLE, "GET /v1/subscriptions/602/versions": page([]) });
  assert.deepEqual((await runCommand(release, { api: noProductVersion.api, words: ["submit", VERSION_ID], flags: { subscription: ["602"] } })).said("error"), [
    "The subscription 602 has no version to submit.",
  ]);
  const noApp = ascRoutes({
    [VERSION_READ(["app", "build"])]: { data: appVersion({}, { build: link("builds", BUILD_ID) }), included: [one("builds", BUILD_ID)] },
  });
  assert.deepEqual((await runCommand(release, { api: noApp.api, words: ["submit", VERSION_ID] })).said("error"), [`Apple named no app for version ${VERSION_ID}.`]);
});

test("release sends a release request for a version pending developer release, after confirming", async () => {
  const { api, writes } = ascRoutes({
    [VERSION_READ()]: { data: appVersion({ appVersionState: "PENDING_DEVELOPER_RELEASE" }) },
    "POST /v1/appStoreVersionReleaseRequests": { data: one("appStoreVersionReleaseRequests", "RR1") },
  });
  const refused = await runCommand(release, { api, words: ["release", VERSION_ID] });
  assert.deepEqual(refused.said("error"), ["Release version 1.2.0 to the App Store\nNothing was changed. Pass --yes to go ahead."]);
  const done = await runCommand(release, { api, words: ["release", VERSION_ID], flags: { yes: true } });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/appStoreVersionReleaseRequests",
      body: { data: { type: "appStoreVersionReleaseRequests", relationships: { appStoreVersion: link("appStoreVersions", VERSION_ID) } } },
    },
  ]);
  assert.deepEqual(done.said("success"), ["Released version 1.2.0"]);
});

test("release refuses any other state", async () => {
  const { api, writes } = ascRoutes({ [VERSION_READ()]: { data: appVersion({ appVersionState: "WAITING_FOR_REVIEW" }) } });
  const result = await runCommand(release, { api, words: ["release", VERSION_ID], flags: { yes: true } });
  assert.deepEqual(result.said("error"), ["Version 1.2.0 is WAITING_FOR_REVIEW; only a version pending developer release (PENDING_DEVELOPER_RELEASE) can be released."]);
  const unknown = ascRoutes({ [VERSION_READ()]: { data: one("appStoreVersions", VERSION_ID) } });
  assert.match((await runCommand(release, { api: unknown.api, words: ["release", VERSION_ID] })).said("error")[0] ?? "", new RegExp(`^Version ${VERSION_ID} is in an unknown state`));
  assert.deepEqual(writes(), []);
});

test("phased start turns phased release on for a version that has none", async () => {
  const { api, writes } = ascRoutes({
    [PHASED]: { data: null },
    "POST /v1/appStoreVersionPhasedReleases": { data: one("appStoreVersionPhasedReleases", "PR1", { phasedReleaseState: "INACTIVE" }) },
  });
  const result = await runCommand(release, { api, words: ["phased", "START", VERSION_ID], json: true });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/appStoreVersionPhasedReleases",
      body: { data: { type: "appStoreVersionPhasedReleases", relationships: { appStoreVersion: link("appStoreVersions", VERSION_ID) } } },
    },
  ]);
  assert.deepEqual(result.json, { appStoreVersion: VERSION_ID, phasedRelease: { id: "PR1", phasedReleaseState: "INACTIVE" } });
  const none = ascRoutes({ [PHASED]: { data: null }, "POST /v1/appStoreVersionPhasedReleases": { data: null } });
  assert.deepEqual((await runCommand(release, { api: none.api, words: ["phased", "start", VERSION_ID] })).said("error"), ["Apple created no phased release."]);
});

test("phased pause, resume and complete move the state Apple allows", async () => {
  const cases: [string, string, string][] = [
    ["pause", "ACTIVE", "PAUSED"],
    ["resume", "PAUSED", "ACTIVE"],
    ["complete", "PAUSED", "COMPLETE"],
  ];
  for (const [action, from, to] of cases) {
    const { api, writes } = ascRoutes({
      [PHASED]: { data: one("appStoreVersionPhasedReleases", "PR1", { phasedReleaseState: from, currentDayNumber: 4 }) },
      "PATCH /v1/appStoreVersionPhasedReleases/PR1": undefined,
    });
    const result = await runCommand(release, { api, words: ["phased", action, VERSION_ID] });
    assert.deepEqual(writes(), [
      {
        method: "PATCH",
        path: "/v1/appStoreVersionPhasedReleases/PR1",
        body: { data: { type: "appStoreVersionPhasedReleases", id: "PR1", attributes: { phasedReleaseState: to } } },
      },
    ]);
    assert.deepEqual(result.said("success"), [`Phased release of version ${VERSION_ID}: ${to}`]);
  }
});

test("phased refuses what the current state doesn't allow", async () => {
  const active = ascRoutes({ [PHASED]: { data: one("appStoreVersionPhasedReleases", "PR1", { phasedReleaseState: "ACTIVE" }) } });
  assert.deepEqual((await runCommand(release, { api: active.api, words: ["phased", "start", VERSION_ID] })).said("error"), [`Version ${VERSION_ID} already has a phased release (ACTIVE).`]);
  assert.deepEqual((await runCommand(release, { api: active.api, words: ["phased", "resume", VERSION_ID] })).said("error"), [
    `The phased release of version ${VERSION_ID} is ACTIVE; resume needs PAUSED.`,
  ]);
  const stateless = ascRoutes({ [PHASED]: { data: one("appStoreVersionPhasedReleases", "PR1") } });
  assert.deepEqual((await runCommand(release, { api: stateless.api, words: ["phased", "start", VERSION_ID] })).said("error"), [`Version ${VERSION_ID} already has a phased release (state unknown).`]);
  assert.deepEqual((await runCommand(release, { api: stateless.api, words: ["phased", "complete", VERSION_ID] })).said("error"), [
    `The phased release of version ${VERSION_ID} is in an unknown state; complete needs ACTIVE or PAUSED.`,
  ]);
  const none = ascRoutes({ [PHASED]: { data: null } });
  assert.deepEqual((await runCommand(release, { api: none.api, words: ["phased", "pause", VERSION_ID] })).said("error"), [
    `Version ${VERSION_ID} has no phased release. Turn it on with asc release phased start ${VERSION_ID}.`,
  ]);
  const bad = await runCommand(release, { api: none.api, words: ["phased", "stop", VERSION_ID] });
  assert.deepEqual(bad.said("error"), ['asc release phased takes <action> as one of: start, pause, resume, complete (not "stop").']);
  assert.deepEqual([...active.writes(), ...stateless.writes(), ...none.writes()], []);
});

test("status shows the version, its build, its latest review submission and its phased release", async () => {
  const { api } = ascRoutes({
    [VERSION_READ(["app", "build", "appStoreVersionPhasedRelease"])]: {
      data: appVersion({ appVersionState: "WAITING_FOR_REVIEW" }, {
        app: link("apps", "555"),
        build: link("builds", BUILD_ID),
        appStoreVersionPhasedRelease: link("appStoreVersionPhasedReleases", "PR1"),
      }),
      included: [one("builds", BUILD_ID, { version: "33" }), one("appStoreVersionPhasedReleases", "PR1", { phasedReleaseState: "INACTIVE" })],
    },
    [STATUS_SUBMISSIONS]: page([
      one("reviewSubmissions", "RS-other", { state: "COMPLETE" }, { appStoreVersionForReview: link("appStoreVersions", "other") }),
      one("reviewSubmissions", "RS1", { state: "WAITING_FOR_REVIEW", submittedDate: "2026-10-20" }, { appStoreVersionForReview: link("appStoreVersions", VERSION_ID) }),
    ]),
  });
  const result = await runCommand(release, { api, words: ["status", VERSION_ID], json: true });
  assert.deepEqual(result.json, {
    id: VERSION_ID,
    versionString: "1.2.0",
    platform: "IOS",
    appVersionState: "WAITING_FOR_REVIEW",
    releaseType: "MANUAL",
    build: { id: BUILD_ID, version: "33" },
    reviewSubmission: { id: "RS1", state: "WAITING_FOR_REVIEW", submittedDate: "2026-10-20" },
    phasedRelease: { id: "PR1", phasedReleaseState: "INACTIVE" },
  });
  const human = await runCommand(release, { api, words: ["status", VERSION_ID] });
  assert.deepEqual(human.said("success"), ["Version 1.2.0: WAITING_FOR_REVIEW"]);
});

test("status of a version never submitted", async () => {
  const { api } = ascRoutes({
    [VERSION_READ(["app", "build", "appStoreVersionPhasedRelease"])]: { data: one("appStoreVersions", VERSION_ID, {}, { app: link("apps", "555") }) },
    [STATUS_SUBMISSIONS]: page([]),
  });
  const result = await runCommand(release, { api, words: ["status", VERSION_ID], json: true });
  assert.deepEqual(result.json, { id: VERSION_ID, build: null, reviewSubmission: null, phasedRelease: null });
  const human = await runCommand(release, { api, words: ["status", VERSION_ID] });
  assert.deepEqual(human.said("success"), [`Version ${VERSION_ID}: state unknown`]);
});
