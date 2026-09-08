// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageDirection, unwrap, wrap, type TIncomingMessage } from "@superwall/protocol";
import pingReply from "../../protocol/test/fixtures/host/ping-reply.json";
import { attachToWindow, createPaywallHost, createWindowHost, recordingDelegate } from "../src";
import { fixtureState } from "./messages.test";

const ping = wrap(
  { event_name: "ping", substitutions: [], page_styles: [] },
  MessageDirection.FromPaywall,
);

const deliver = (data: unknown, source: MessageEventSource | null = window) => {
  window.dispatchEvent(new MessageEvent("message", { data, source }));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("window host", () => {
  it("answers a ping from the target window with the envelope, as a string", () => {
    const posted: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      posted.push(message);
    });
    const { host, detach } = createWindowHost({
      target: window,
      state: fixtureState(),
      delegate: recordingDelegate(),
    });
    deliver(ping);
    expect(posted).toHaveLength(1);
    const wire = posted[0];
    if (typeof wire !== "string") throw new Error("host must post a string envelope");
    expect(unwrap<TIncomingMessage>(wire, MessageDirection.ToPaywall)).toEqual(pingReply.events);
    detach();
    deliver(ping);
    expect(posted).toHaveLength(1);
    expect(host.state.paywallId).toBe("123");
  });

  it("ignores foreign sources, non-string data and wrong directions", () => {
    const received: unknown[] = [];
    const host = createPaywallHost({
      delegate: recordingDelegate(),
      send: (events) => {
        received.push(...events);
      },
    });
    const detach = attachToWindow(host, window, { listen: window });
    deliver(ping, null);
    deliver({ not: "a string" });
    deliver(wrap({ event_name: "close" }, MessageDirection.ToPaywall));
    expect(received).toEqual([]);
    deliver(ping);
    expect(received).toHaveLength(5);
    detach();
  });
});
