import { describe, expect, it } from "vitest";
import { decodeBase64Utf8, decodeIncomingMessages } from "../../src/bridge/base64";
import { encodeBatch } from "../support/testTransport";

describe("decodeIncomingMessages", () => {
  const batch = [
    { event_name: "paywall_open", paywall_id: "pw", paywall_identifier: "pw-id" },
    { event_name: "products", products: [{ product: "primary", productId: "pro" }] },
  ];

  it("decodes standard base64 batches", () => {
    expect(decodeIncomingMessages(encodeBatch(batch))).toHaveLength(2);
  });

  it("decodes URL-safe and unpadded base64 (Android Base64.URL_SAFE)", () => {
    const urlSafe = encodeBatch(batch).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeIncomingMessages(urlSafe)).toHaveLength(2);
  });

  it("keeps the whole batch when it contains unrecognized messages", () => {
    const withUnknown = [
      { eventName: "experiment", experimentId: "e", variantId: "v", campaignId: "c" },
      { event_name: "some_future_event", value: 1 },
      null,
      42,
      ...batch,
    ];

    const decoded = decodeIncomingMessages(encodeBatch(withUnknown));
    expect(decoded).toHaveLength(4);
    expect(decoded[0]).toMatchObject({ eventName: "experiment" });
  });

  it("returns an empty array for non-array payloads", () => {
    expect(decodeIncomingMessages(encodeBatch({ event_name: "paywall_open" }))).toEqual([]);
  });

  it("throws on input that is not base64 JSON, for the caller to report", () => {
    expect(() => decodeIncomingMessages("not base64 json %%%")).toThrow();
  });
});

describe("decodeBase64Utf8", () => {
  it("decodes multi-byte text", () => {
    expect(decodeBase64Utf8(Buffer.from("héllo ✓", "utf8").toString("base64"))).toBe("héllo ✓");
  });
});
