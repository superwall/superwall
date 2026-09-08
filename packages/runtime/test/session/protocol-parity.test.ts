import { describe, expect, it } from "vitest";
import { createSuperwallSession } from "../../src";
import { TestTransport } from "../support/testTransport";

/**
 * Headless paywalls must speak the exact v4 document protocol: same messages,
 * same fields, same order. The SDK hosts (iOS/Android/web controller) were
 * built against v4 documents and treat both generations identically — any
 * extra field or reordered handshake here is a cross-repo breaking change.
 * These tests pin that contract; do not "extend" the protocol to fix a
 * feature gap.
 */
describe("v4 protocol parity", () => {
  it("sends the v4 handshake ping and nothing else on start", () => {
    const transport = new TestTransport();
    const session = createSuperwallSession({
      transport,
      config: { products: { monthly: "test:price_123:no-trial", annual: "pro_5999_year" } },
    });

    session.start({ sendPing: true });

    expect(transport.outgoing).toEqual([
      { event_name: "ping", substitutions: [], page_styles: [], version: "4.0.0" },
    ]);
    expect(Object.keys(transport.outgoing[0] ?? {}).toSorted()).toEqual([
      "event_name",
      "page_styles",
      "substitutions",
      "version",
    ]);
  });

  it("sends purchase with the v4 fields: product reference plus identifier", () => {
    const transport = new TestTransport();
    const session = createSuperwallSession({
      transport,
      config: { products: { monthly: "test:price_123:no-trial" } },
    });
    session.start();
    session.purchase("monthly");

    expect(transport.outgoing.find((message) => message.event_name === "purchase")).toEqual({
      event_name: "purchase",
      product: "monthly",
      product_identifier: "test:price_123:no-trial",
    });
  });
});
