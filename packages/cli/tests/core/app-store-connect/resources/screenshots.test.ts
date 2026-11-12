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
import { pngBytes } from "../../../helpers/images";

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

const file = join(mkdtempSync(join(tmpdir(), "asc-shot-")), "paywall.png");
const bytes = pngBytes(1290, 2796);
writeFileSync(file, bytes);
const checksum = createHash("md5").update(bytes).digest("hex");

const reserved = one("subscriptionAppStoreReviewScreenshots", "NEW", {
  uploadOperations: [
    { method: "PUT", url: "https://upload.apple.example/part1", offset: 0, length: 20, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
    { url: "https://upload.apple.example/part2", offset: 20, length: 9 },
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
      ["PUT", "https://upload.apple.example/part1", String(bytes.slice(0, 20))],
      ["PUT", "https://upload.apple.example/part2", String(bytes.slice(20, 29))],
    ],
  );
  assert.deepEqual(writes(), [
    { method: "DELETE", path: "/v1/subscriptionAppStoreReviewScreenshots/OLD" },
    {
      method: "POST",
      path: "/v1/subscriptionAppStoreReviewScreenshots",
      body: {
        data: {
          type: "subscriptionAppStoreReviewScreenshots",
          attributes: { fileName: "paywall.png", fileSize: 29 },
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
  assert.deepEqual(result.json, { id: "NEW", fileName: "paywall.png", fileSize: 29, state: "COMPLETE", replaced: "OLD" });
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

test("a file that isn't a real PNG or JPEG is refused before anything is sent to Apple", async () => {
  const fake = join(mkdtempSync(join(tmpdir(), "asc-shot-")), "paywall.png");
  writeFileSync(fake, "0123456789");
  const { api, writes } = ascRoutes({});
  const fetches = useFetch([]);
  const result = await runCommand(screenshots, { api, words: ["upload", fake], flags: { subscription: "601" } });
  assert.deepEqual(result.said("error"), ["paywall.png isn't a PNG or JPEG image. Export it again as PNG or JPEG."]);
  assert.deepEqual(writes(), []);
  assert.deepEqual(fetches, []);
});
