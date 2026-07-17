import { describe, expect, it, vi } from "vitest";
import { createSuperwallBridge } from "../src/bridge";
import { TestTransport } from "./testTransport";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

describe("SuperwallBridge", () => {
  it("logs outgoing messages and forwards them to the transport", () => {
    const transport = new TestTransport();
    const bridge = createSuperwallBridge({ transport });

    bridge.postMessage({ event_name: "close" });

    expect(transport.outgoing).toEqual([{ event_name: "close" }]);
    expect(bridge.messages).toMatchObject([{ type: "outgoing", msg: { event_name: "close" } }]);
  });

  it("logs incoming messages and notifies listeners, honoring removal", () => {
    const transport = new TestTransport();
    const bridge = createSuperwallBridge({ transport });
    const handler = vi.fn();

    const remove = bridge.addListener(handler);
    bridge.start();
    transport.accept({ event_name: "paywall_open", paywall_id: "p", paywall_identifier: "i" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(bridge.messages).toMatchObject([{ type: "incoming" }]);

    remove();
    transport.accept({ event_name: "paywall_open", paywall_id: "p2", paywall_identifier: "i" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("accept64 delivers decoded batches through the transport", () => {
    const transport = new TestTransport();
    const bridge = createSuperwallBridge({ transport });
    const handler = vi.fn();
    bridge.addListener(handler);
    bridge.start();

    bridge.accept64(
      encode([
        { event_name: "products", products: [] },
        { event_name: "template_variables", variables: {} },
      ]),
    );

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("accept64 reports decode errors without throwing", () => {
    const transport = new TestTransport();
    const onDecodeError = vi.fn();
    const bridge = createSuperwallBridge({ transport, onDecodeError });

    expect(() => bridge.accept64("not base64 json %%%")).not.toThrow();
    expect(onDecodeError).toHaveBeenCalledTimes(1);
  });

  it("stamps log entries with the injected clock", () => {
    const transport = new TestTransport();
    const now = new Date("2026-07-17T00:00:00Z");
    const bridge = createSuperwallBridge({ transport, now: () => now });

    bridge.postMessage({ event_name: "close" });
    expect(bridge.messages[0]?.ts).toBe(now);
  });
});
