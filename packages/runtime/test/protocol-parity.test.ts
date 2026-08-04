import { describe, expect, it } from "vitest";
import { createSuperwallSession } from "../src";
import { TestTransport } from "./testTransport";

/**
 * Headless paywalls must speak the exact v4 document protocol: same messages,
 * same fields, same order. The SDK hosts (iOS/Android/web controller) were
 * built against v4 documents and treat both generations identically — any
 * extra field or reordered handshake here is a cross-repo breaking change.
 * These tests pin that contract; do not "extend" the protocol to fix a
 * feature gap. Product data, for example, is attached at push and resolved
 * host-side, never negotiated over the bridge.
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
      {
        event_name: "ping",
        substitutions: [],
        page_styles: [],
        version: "4.0.0",
      },
    ]);
  });

  it("keeps the ping payload keys identical to a v4 document's", () => {
    const transport = new TestTransport();
    const session = createSuperwallSession({
      transport,
      config: { products: { monthly: "test:price_123:no-trial" } },
    });

    session.start({ sendPing: true });

    const ping = transport.outgoing[0] as Record<string, unknown>;
    expect(Object.keys(ping).sort()).toEqual([
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

    const purchase = transport.outgoing.find(
      (message) => message.event_name === "purchase",
    ) as Record<string, unknown>;
    expect(purchase).toBeDefined();
    expect(purchase.product).toBe("monthly");
  });
});
