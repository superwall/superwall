import { describe, expect, it } from "vitest";
import { decodeIncomingMessages } from "../src/bridge/base64";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

describe("decodeIncomingMessages", () => {
  const batch = [
    { event_name: "paywall_open", paywall_id: "pw", paywall_identifier: "pw-id" },
    { event_name: "products", products: [{ product: "primary", productId: "pro" }] },
  ];

  it("decodes standard base64 batches", () => {
    expect(decodeIncomingMessages(encode(batch))).toHaveLength(2);
  });

  it("decodes URL-safe and unpadded base64 (Android Base64.URL_SAFE)", () => {
    const urlSafe = encode(batch).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeIncomingMessages(urlSafe)).toHaveLength(2);
  });

  it("keeps the whole batch when it contains unrecognized messages", () => {
    const withUnknown = [
      // legacy quirk: experiment arrives miscased from some SDK versions
      { eventName: "experiment", experimentId: "e", variantId: "v", campaignId: "c" },
      { event_name: "some_future_event", value: 1 },
      ...batch,
    ];

    const decoded = decodeIncomingMessages(encode(withUnknown));
    expect(decoded).toHaveLength(4);
    expect((decoded[0] as Record<string, unknown>).eventName).toBe("experiment");
  });

  it("returns an empty array for non-array payloads", () => {
    expect(decodeIncomingMessages(encode({ event_name: "paywall_open" }))).toEqual([]);
  });

  it("falls back to Buffer when atob is unavailable", () => {
    const originalAtob = globalThis.atob;
    // @ts-expect-error - simulating a runtime without atob
    globalThis.atob = undefined;
    try {
      expect(decodeIncomingMessages(encode(batch))).toHaveLength(2);
    } finally {
      globalThis.atob = originalAtob;
    }
  });
});
