import { afterEach, describe, expect, it, vi } from "vitest";
import type { TIncomingMessage } from "@superwall/protocol";
import { createHostTransport, recordingDelegate } from "../src";
import { fixtureState } from "./messages.test";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("host transport", () => {
  it("delivers the ping reply to listeners on a microtask", async () => {
    const { transport, host } = createHostTransport({
      state: fixtureState(),
      delegate: recordingDelegate(),
    });
    const received: TIncomingMessage[] = [];
    transport.addListener((message) => received.push(message));
    transport.startListening();
    transport.postMessage({ event_name: "ping", substitutions: [], page_styles: [] });
    expect(received).toEqual([]);
    await flush();
    expect(received.map((event) => event.event_name)).toEqual([
      "template_variables",
      "experiment",
      "products",
      "template_substitutions_prefix",
      "paywall_open",
    ]);
    expect(host.state.paywallIdentifier).toBe("my_paywall");
  });

  it("drops replies until the paywall listens, like the SDK transports", async () => {
    const { transport } = createHostTransport({ delegate: recordingDelegate() });
    const received: TIncomingMessage[] = [];
    transport.addListener((message) => received.push(message));
    transport.postMessage({ event_name: "ping", substitutions: [], page_styles: [] });
    await flush();
    expect(received).toEqual([]);
    transport.accept({ event_name: "restore_start" });
    expect(received).toEqual([]);
    transport.startListening();
    transport.accept({ event_name: "restore_start" });
    expect(received).toEqual([{ event_name: "restore_start" }]);
  });

  it("waits for the configured latency", async () => {
    vi.useFakeTimers();
    const { transport } = createHostTransport({ delegate: recordingDelegate(), latencyMs: 50 });
    const received: TIncomingMessage[] = [];
    transport.addListener((message) => received.push(message));
    transport.startListening();
    transport.postMessage({ event_name: "close" });
    await vi.advanceTimersByTimeAsync(49);
    expect(received).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(received.map((event) => event.event_name)).toEqual(["paywall_close"]);
  });
});
