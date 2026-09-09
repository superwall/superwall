import { describe, expect, it } from "vitest";
import { createPaywallHost, silentDelegate } from "../src";
import { fixtureState } from "./messages.test";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("silent delegate", () => {
  it("answers everything the happy way and performs nothing", async () => {
    const delegate = silentDelegate();
    delegate.close();
    delegate.openUrl("https://superwall.com", "external");
    delegate.custom("data");
    delegate.customPlacement("upsell", {});
    delegate.event({ event_name: "close" });
    expect(delegate.purchase({ reference: "a", productId: "a", variables: {} })).toBe("completed");
    expect(delegate.restore()).toBe("restored");
    expect(delegate.permission("camera")).toBe("granted");
    expect(delegate.callback("sync", {})).toEqual({ status: "success" });
  });

  it("lets a host complete a purchase with no one watching", async () => {
    const sent: string[] = [];
    const host = createPaywallHost({
      state: fixtureState(),
      delegate: silentDelegate(),
      send: (events) => {
        sent.push(...events.map((event) => event.event_name));
      },
    });
    host.receive([{ event_name: "purchase", product: "primary" }]);
    await flush();
    expect(sent).toEqual(["transaction_start", "transaction_complete", "freeTrial_start"]);
  });
});

describe("recordingDelegate's fixed answers", () => {
  it("takes a plain value as the answer to every ask", async () => {
    const { recordingDelegate } = await import("../src/delegate/recording");
    const delegate = recordingDelegate({
      purchase: "abandoned",
      restore: "failed",
      permission: "denied",
      callback: { status: "failure" },
    });

    expect(await delegate.purchase({ reference: "a", productId: "a", variables: {} })).toBe(
      "abandoned",
    );
    expect(await delegate.restore()).toBe("failed");
    expect(await delegate.permission("notification")).toBe("denied");
    expect(await delegate.callback("done", {})).toEqual({ status: "failure" });
  });

  it("falls back to the answers a device would most often give", async () => {
    const { recordingDelegate } = await import("../src/delegate/recording");
    const delegate = recordingDelegate();

    expect(await delegate.purchase({ reference: "a", productId: "a", variables: {} })).toBe(
      "completed",
    );
    expect(await delegate.restore()).toBe("restored");
    expect(await delegate.permission("notification")).toBe("granted");
    expect(await delegate.callback("done", {})).toEqual({ status: "success" });
  });
});
