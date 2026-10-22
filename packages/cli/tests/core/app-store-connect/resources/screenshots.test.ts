import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { command as screenshots } from "@/commands/app-store-connect/store/screenshots";
import { ascRoutes, link, one } from "../../../helpers/asc-proxy";
import { restoreFetch, useFetch } from "../../../helpers/fetch";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

const file = join(mkdtempSync(join(tmpdir(), "asc-shot-")), "paywall.png");
writeFileSync(file, "0123456789");
const checksum = createHash("md5").update("0123456789").digest("hex");

const reserved = one("subscriptionAppStoreReviewScreenshots", "NEW", {
  uploadOperations: [
    { method: "PUT", url: "https://upload.apple.example/part1", offset: 0, length: 6, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
    { url: "https://upload.apple.example/part2", offset: 6, length: 4 },
    "not an operation",
  ],
});

test("upload replaces the screenshot: delete the old, reserve, upload each part, commit with the checksum, wait for Apple", async () => {
  let polls = 0;
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: one("subscriptionAppStoreReviewScreenshots", "OLD") },
    "DELETE /v1/subscriptionAppStoreReviewScreenshots/OLD": undefined,
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": { data: one("subscriptionAppStoreReviewScreenshots", "NEW") },
    "GET /v1/subscriptionAppStoreReviewScreenshots/NEW": () => {
      polls += 1;
      return { data: one("subscriptionAppStoreReviewScreenshots", "NEW", { assetDeliveryState: { state: polls === 1 ? "UPLOAD_COMPLETE" : "COMPLETE" } }) };
    },
  });
  const uploads = useFetch([{ match: "upload.apple.example", text: "" }]);
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601" }, json: true });
  assert.deepEqual(
    uploads.map((upload) => [upload.method, upload.url, upload.body]),
    [
      ["PUT", "https://upload.apple.example/part1", "0,1,2,3,4,5"],
      ["PUT", "https://upload.apple.example/part2", "6,7,8,9"],
    ].map(([method, url, body]) => [method, url, String(new Uint8Array(String(body).split(",").map((digit) => 48 + Number(digit))))]),
  );
  assert.deepEqual(writes(), [
    { method: "DELETE", path: "/v1/subscriptionAppStoreReviewScreenshots/OLD" },
    {
      method: "POST",
      path: "/v1/subscriptionAppStoreReviewScreenshots",
      body: {
        data: {
          type: "subscriptionAppStoreReviewScreenshots",
          attributes: { fileName: "paywall.png", fileSize: 10 },
          relationships: { subscription: link("subscriptions", "601") },
        },
      },
    },
    {
      method: "PATCH",
      path: "/v1/subscriptionAppStoreReviewScreenshots/NEW",
      body: { data: { type: "subscriptionAppStoreReviewScreenshots", id: "NEW", attributes: { uploaded: true, sourceFileChecksum: checksum } } },
    },
  ]);
  assert.equal(polls, 2);
  assert.deepEqual(result.json, { id: "NEW", fileName: "paywall.png", fileSize: 10, state: "COMPLETE", replaced: "OLD" });
});

test("an in-app purchase's first screenshot, and Apple failing to process it", async () => {
  const { api, writes } = ascRoutes({
    "GET /v2/inAppPurchases/701/appStoreReviewScreenshot": { data: null },
    "POST /v1/inAppPurchaseAppStoreReviewScreenshots": { data: one("inAppPurchaseAppStoreReviewScreenshots", "NEW") },
    "PATCH /v1/inAppPurchaseAppStoreReviewScreenshots/NEW": undefined,
    "GET /v1/inAppPurchaseAppStoreReviewScreenshots/NEW": {
      data: one("inAppPurchaseAppStoreReviewScreenshots", "NEW", { assetDeliveryState: { state: "FAILED", errors: [{ code: "IMAGE_TOO_SMALL" }] } }),
    },
  });
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { iap: "701" } });
  assert.deepEqual(result.said("error"), ['Apple couldn\'t process the screenshot: [{"code":"IMAGE_TOO_SMALL"}]']);
  const reservation = writes()[0]?.body as { data: { relationships: unknown } };
  assert.deepEqual(reservation.data.relationships, { inAppPurchaseV2: link("inAppPurchases", "701") });
});

test("an upload Apple refuses stops before the commit", async () => {
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
  });
  useFetch([{ match: "upload.apple.example", status: 403, text: "no" }]);
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601" } });
  assert.deepEqual(result.said("error"), ["Apple refused the upload to upload.apple.example (403)."]);
  assert.equal(writes().length, 1);
});

test("Apple reserving nothing, or a screenshot it no longer reports, end the upload", async () => {
  const { api } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": {},
  });
  const nothing = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601" } });
  assert.deepEqual(nothing.said("error"), ["Apple reserved no upload for the screenshot."]);
  const { api: gone } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: one("subscriptionAppStoreReviewScreenshots", "NEW") },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": undefined,
    "GET /v1/subscriptionAppStoreReviewScreenshots/NEW": { data: null },
  });
  const done = await runCommand(screenshots, { api: gone, words: ["upload", file], flags: { subscription: "601" } });
  assert.deepEqual(done.said("success"), ["Uploaded paywall.png"]);
});

test("a dry run reads the file and plans the upload without sending it", async () => {
  const { api, writes } = ascRoutes({ "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null } });
  const fetches = useFetch([]);
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601", dryRun: true }, json: true });
  assert.deepEqual(writes(), []);
  assert.deepEqual(fetches, []);
  assert.deepEqual(
    (result.json as { requests: { method: string; path: string }[] }).requests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /v1/subscriptions/601/appStoreReviewScreenshot",
      "POST /v1/subscriptionAppStoreReviewScreenshots",
      "PUT <each upload URL Apple returns>",
      "PATCH /v1/subscriptionAppStoreReviewScreenshots/${screenshot}",
      "GET /v1/subscriptionAppStoreReviewScreenshots/${screenshot}",
    ],
  );
});
