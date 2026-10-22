import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as submit } from "@/commands/app-store-connect/store/submit";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { APP_BY_BUNDLE } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const OPEN = "GET /v1/reviewSubmissions?filter[app]=555&filter[state]=READY_FOR_REVIEW&filter[platform]=IOS&limit=1";
const VERSIONS = {
  "GET /v1/subscriptionGroups/201/versions": page([one("subscriptionGroupVersions", "GV1", { version: 1, state: "PREPARE_FOR_SUBMISSION" })]),
  "GET /v1/subscriptions/601/versions": page([one("subscriptionVersions", "V1", { version: 1, state: "PREPARE_FOR_SUBMISSION" })]),
  "GET /v2/inAppPurchases/701/versions": page([one("inAppPurchaseVersions", "IV1", { version: 1, state: "PREPARE_FOR_SUBMISSION" })]),
};

const item = (relationship: string, type: string, id: string, submission: string) => ({
  method: "POST",
  path: "/v1/reviewSubmissionItems",
  body: {
    data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: link("reviewSubmissions", submission), [relationship]: link(type, id) } },
  },
});

test("opens a review submission, adds each item's latest version, then submits it", async () => {
  const { api, writes } = ascRoutes({
    [APP_BY_BUNDLE]: page([one("apps", "555")]),
    ...VERSIONS,
    [OPEN]: page([]),
    "POST /v1/reviewSubmissions": { data: one("reviewSubmissions", "RS1") },
    "POST /v1/reviewSubmissionItems": { data: one("reviewSubmissionItems", "I") },
    "PATCH /v1/reviewSubmissions/RS1": { data: one("reviewSubmissions", "RS1", { state: "WAITING_FOR_REVIEW" }) },
  });
  const result = await runCommand(submit, {
    api,
    flags: { ascApp: "com.acme.app", group: ["201"], subscription: ["601"], iap: ["701"] },
    json: true,
  });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/reviewSubmissions",
      body: { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: link("apps", "555") } } },
    },
    item("subscriptionGroupVersion", "subscriptionGroupVersions", "GV1", "RS1"),
    item("subscriptionVersion", "subscriptionVersions", "V1", "RS1"),
    item("inAppPurchaseVersion", "inAppPurchaseVersions", "IV1", "RS1"),
    { method: "PATCH", path: "/v1/reviewSubmissions/RS1", body: { data: { type: "reviewSubmissions", id: "RS1", attributes: { submitted: true } } } },
  ]);
  const { reviewSubmission } = result.json as { reviewSubmission: unknown };
  assert.deepEqual(reviewSubmission, { id: "RS1", state: "WAITING_FOR_REVIEW", reused: false });
});

test("reuses the app's open submission", async () => {
  const { api, writes } = ascRoutes({
    ...VERSIONS,
    [OPEN]: page([one("reviewSubmissions", "RS0", { state: "READY_FOR_REVIEW" })]),
    "POST /v1/reviewSubmissionItems": { data: one("reviewSubmissionItems", "I") },
    "PATCH /v1/reviewSubmissions/RS0": undefined,
  });
  const human = await runCommand(submit, { api, flags: { ascApp: "555", subscription: ["601"] } });
  assert.deepEqual(
    writes().map((request) => `${request.method} ${request.path}`),
    ["POST /v1/reviewSubmissionItems", "PATCH /v1/reviewSubmissions/RS0"],
  );
  assert.deepEqual(human.said("success"), ["Submitted 1 item for review"]);
});

test("a dry run plans the submission and sends nothing", async () => {
  const { api, writes } = ascRoutes({ ...VERSIONS, [OPEN]: page([]) });
  const result = await runCommand(submit, { api, flags: { ascApp: "555", iap: ["701"], dryRun: true }, json: true });
  assert.deepEqual(writes(), []);
  assert.deepEqual(
    (result.json as { requests: { method: string; path: string }[] }).requests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /v2/inAppPurchases/701/versions",
      `${OPEN}`,
      "POST /v1/reviewSubmissions",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/${submission}",
    ],
  );
});

test("needs the app and something to submit, each with a version", async () => {
  const { api } = ascRoutes({ "GET /v1/subscriptions/602/versions": page([]), "POST /v1/reviewSubmissions": {}, [OPEN]: page([]), ...VERSIONS });
  const noApp = await runCommand(submit, { api, flags: { subscription: ["601"] } });
  assert.deepEqual(noApp.said("error"), ["Pass --asc-app <id|bundle id>: the App Store app to submit for."]);
  const nothing = await runCommand(submit, { api, flags: { ascApp: "555" } });
  assert.deepEqual(nothing.said("error"), ["Say what to submit: --subscription, --group or --iap <id>, each as often as needed."]);
  const noVersion = await runCommand(submit, { api, flags: { ascApp: "555", subscription: ["602"] } });
  assert.deepEqual(noVersion.said("error"), ["The subscription 602 has no version to submit."]);
  const unopened = await runCommand(submit, { api, flags: { ascApp: "555", subscription: ["601"] } });
  assert.deepEqual(unopened.said("error"), ["Apple opened no review submission."]);
});
