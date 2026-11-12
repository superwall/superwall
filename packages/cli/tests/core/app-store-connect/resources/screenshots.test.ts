import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, mock, test } from "node:test";
import { command as screenshots } from "@/commands/app-store-connect/store/screenshots";
import { ApiError } from "@/core/api/client";
import { ascRoutes, link, one } from "../../../helpers/asc-proxy";
import { restoreFetch, useFetch } from "../../../helpers/fetch";
import { runCommand } from "../../../helpers/command";
import { pngBytes } from "../../../helpers/images";

afterEach(() => {
  mock.restoreAll();
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

const appleDown = () =>
  new ApiError(
    "PATCH /v2/organizations/7/app-store-connect/proxy/T1/v1/subscriptionAppStoreReviewScreenshots/NEW",
    500,
    JSON.stringify({ errors: [{ status: "500", code: "UNEXPECTED_ERROR", title: "An unexpected error occurred.", detail: "An unexpected error occurred on the server side." }] }),
  );
const shot = (state: string) => ({ data: one("subscriptionAppStoreReviewScreenshots", "NEW", { assetDeliveryState: { state } }) });

function recordPauses(): number[] {
  const pauses: number[] = [];
  mock.method(globalThis, "setTimeout", (done: () => void, ms: number) => {
    pauses.push(ms);
    done();
    return 0;
  });
  return pauses;
}

test("a commit Apple answers with 500 is tried again, with a longer pause each time", async () => {
  const pauses = recordPauses();
  let commits = 0;
  let reads = 0;
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": () => (++commits < 3 ? appleDown() : shot("UPLOAD_COMPLETE")),
    "GET /v1/subscriptionAppStoreReviewScreenshots/NEW": () => (++reads <= 2 ? shot("AWAITING_UPLOAD") : shot("COMPLETE")),
  });
  useFetch([{ match: "upload.apple.example", text: "" }]);
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601" }, json: true });
  assert.equal(commits, 3);
  assert.deepEqual(pauses, [2000, 4000]);
  assert.deepEqual(
    writes().map((write) => write.method),
    ["POST", "PATCH", "PATCH", "PATCH"],
  );
  assert.deepEqual(result.json, { id: "NEW", fileName: "paywall.png", fileSize: 29, state: "COMPLETE" });
});

test("a commit that answers 500 but that Apple already took goes on to wait for delivery", async () => {
  const pauses = recordPauses();
  let commits = 0;
  const { api } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": () => {
      commits += 1;
      return appleDown();
    },
    "GET /v1/subscriptionAppStoreReviewScreenshots/NEW": shot("COMPLETE"),
  });
  useFetch([{ match: "upload.apple.example", text: "" }]);
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601" }, json: true });
  assert.equal(commits, 1);
  assert.deepEqual(pauses, []);
  assert.deepEqual(result.json, { id: "NEW", fileName: "paywall.png", fileSize: 29, state: "COMPLETE" });
});

test("a commit that fails every time deletes the stuck screenshot and says the earlier one is gone", async () => {
  recordPauses();
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: one("subscriptionAppStoreReviewScreenshots", "OLD") },
    "DELETE /v1/subscriptionAppStoreReviewScreenshots/OLD": undefined,
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": () => appleDown(),
    "GET /v1/subscriptionAppStoreReviewScreenshots/NEW": shot("AWAITING_UPLOAD"),
    "DELETE /v1/subscriptionAppStoreReviewScreenshots/NEW": undefined,
  });
  useFetch([{ match: "upload.apple.example", text: "" }]);
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601" } });
  assert.deepEqual(
    writes().map((write) => `${write.method} ${write.path}`),
    [
      "DELETE /v1/subscriptionAppStoreReviewScreenshots/OLD",
      "POST /v1/subscriptionAppStoreReviewScreenshots",
      "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW",
      "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW",
      "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW",
      "DELETE /v1/subscriptionAppStoreReviewScreenshots/NEW",
    ],
  );
  assert.deepEqual(result.said("error"), [
    [
      "Apple failed to commit the screenshot after its bytes were uploaded (3 attempts):",
      "App Store Connect refused PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW (500):",
      "  • An unexpected error occurred on the server side.",
      "Deleted the unfinished screenshot NEW so it doesn't stay in AWAITING_UPLOAD.",
      "The earlier screenshot OLD was deleted before the upload, so this subscription has no review screenshot now.",
      "This is an error on Apple's side. Try the upload again later.",
    ].join("\n"),
  ]);
});

test("when the stuck screenshot can't be read, or can't be deleted, it is left and the error says so", async () => {
  recordPauses();
  const unreadable = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": () => appleDown(),
    "GET /v1/subscriptionAppStoreReviewScreenshots/NEW": new Error("offline"),
  });
  useFetch([{ match: "upload.apple.example", text: "" }]);
  const left = await runCommand(screenshots, { api: unreadable.api, words: ["upload", file], flags: { subscription: "601" } });
  assert.equal(unreadable.writes().filter((write) => write.method === "DELETE").length, 0);
  assert.match(left.said("error")[0] ?? "", /Couldn't read the unfinished screenshot NEW to check its state, so it was left in place/);
  const undeletable = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": () => appleDown(),
    "GET /v1/subscriptionAppStoreReviewScreenshots/NEW": shot("AWAITING_UPLOAD"),
    "DELETE /v1/subscriptionAppStoreReviewScreenshots/NEW": new Error("offline"),
  });
  const stuck = await runCommand(screenshots, { api: undeletable.api, words: ["upload", file], flags: { subscription: "601" } });
  assert.match(stuck.said("error")[0] ?? "", /Couldn't delete the unfinished screenshot NEW, so it stays in AWAITING_UPLOAD: offline/);
});

test("a reservation Apple dropped after a 500 isn't committed again", async () => {
  const pauses = recordPauses();
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": () => appleDown(),
    "GET /v1/subscriptionAppStoreReviewScreenshots/NEW": new ApiError("GET x", 404, JSON.stringify({ errors: [{ detail: "There is no resource with this id." }] })),
  });
  useFetch([{ match: "upload.apple.example", text: "" }]);
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601" } });
  assert.deepEqual(pauses, []);
  assert.deepEqual(
    writes().map((write) => write.method),
    ["POST", "PATCH"],
  );
  assert.match(result.said("error")[0] ?? "", /\(1 attempt\):[\s\S]*Apple no longer has the unfinished screenshot NEW\./);
});

test("a commit Apple refuses with a 4xx is not tried again", async () => {
  const pauses = recordPauses();
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: null },
    "POST /v1/subscriptionAppStoreReviewScreenshots": { data: reserved },
    "PATCH /v1/subscriptionAppStoreReviewScreenshots/NEW": () =>
      new ApiError("PATCH x", 409, JSON.stringify({ errors: [{ detail: "The checksum doesn't match." }] })),
  });
  useFetch([{ match: "upload.apple.example", text: "" }]);
  const result = await runCommand(screenshots, { api, words: ["upload", file], flags: { subscription: "601" } });
  assert.deepEqual(pauses, []);
  assert.deepEqual(
    writes().map((write) => write.method),
    ["POST", "PATCH"],
  );
  assert.deepEqual(result.said("error"), [
    "App Store Connect refused PATCH x (409):\n  • The checksum doesn't match.\nAlready created: subscriptionAppStoreReviewScreenshots NEW.",
  ]);
});
