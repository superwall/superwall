import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostTransport, recordingDelegate } from "@superwall/host";
import type { ITransport, TOutgoingMessage } from "@superwall/runtime";
import { useUser } from "../../src/hooks";
import { HOST_STATE_TIMEOUT_MS, SuperwallProvider } from "../../src/provider/context";
import { testConfig, testDevice, testProducts } from "../helpers";

const hostAnsweringAfter = (latencyMs: number, user: Record<string, unknown> = {}) => {
  const outgoing: string[] = [];
  const delegate = recordingDelegate({});
  const event = delegate.event;
  delegate.event = (message: TOutgoingMessage) => {
    outgoing.push(message.event_name);
    event(message);
  };
  const { transport, host } = createHostTransport({
    latencyMs,
    delegate,
    state: { products: testProducts, device: testDevice, user },
  });
  return { transport, host, outgoing };
};

const recording = (): ITransport & { posted: unknown[] } => {
  const posted: unknown[] = [];
  return {
    posted,
    postMessage: (message) => {
      posted.push(message);
    },
    accept: () => undefined,
    addListener: () => undefined,
    startListening: () => undefined,
  };
};

let renders: unknown[] = [];
let mounts = 0;

const Paywall = () => {
  const user = useUser();
  renders.push(user.onboarding_goal);
  React.useLayoutEffect(() => {
    mounts++;
  }, []);
  return <span>paywall</span>;
};

const paywall = () => screen.queryByText("paywall");

beforeEach(() => {
  renders = [];
  mounts = 0;
  window.history.replaceState({}, "", "/?transport=editor");
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("waiting for the host's first state", () => {
  it("renders the moment a late host answers, already holding its user", () => {
    const { transport } = hostAnsweringAfter(400, { onboarding_goal: "build" });
    render(
      <SuperwallProvider config={testConfig} transport={transport}>
        <Paywall />
      </SuperwallProvider>,
    );

    act(() => vi.advanceTimersByTime(399));
    expect(paywall()).toBeNull();
    expect(renders).toEqual([]);

    act(() => vi.advanceTimersByTime(1));
    expect(paywall()).not.toBeNull();
    expect(renders[0]).toBe("build");
  });

  it("does not fire the timeout after the host has answered", () => {
    const { transport } = hostAnsweringAfter(100, { onboarding_goal: "build" });
    render(
      <SuperwallProvider config={testConfig} transport={transport}>
        <Paywall />
      </SuperwallProvider>,
    );
    act(() => vi.advanceTimersByTime(100));
    expect(vi.getTimerCount()).toBe(0);
    const after = renders.length;

    act(() => vi.advanceTimersByTime(HOST_STATE_TIMEOUT_MS * 2));

    expect(renders).toHaveLength(after);
    expect(mounts).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends the ping in the same commit, before anything is painted", () => {
    const transport = recording();
    render(
      <SuperwallProvider config={testConfig} transport={transport}>
        <Paywall />
      </SuperwallProvider>,
    );

    expect(paywall()).toBeNull();
    expect(transport.posted).toEqual([expect.objectContaining({ event_name: "ping" })]);
  });

  it("waits the full timeout for a host that answers after it, then renders without it", () => {
    const { transport, host } = hostAnsweringAfter(HOST_STATE_TIMEOUT_MS + 500, {
      onboarding_goal: "build",
    });
    render(
      <SuperwallProvider config={testConfig} transport={transport}>
        <Paywall />
      </SuperwallProvider>,
    );

    act(() => vi.advanceTimersByTime(HOST_STATE_TIMEOUT_MS));
    expect(paywall()).not.toBeNull();
    expect(renders[0]).toBeUndefined();

    act(() => vi.advanceTimersByTime(500));
    expect(renders.at(-1)).toBe("build");
    expect(mounts).toBe(1);
    expect(host.state.user).toEqual({ onboarding_goal: "build" });
  });

  it("keeps the paywall mounted when the host sends fresher state later", () => {
    const { transport, host } = hostAnsweringAfter(1, { onboarding_goal: "build" });
    render(
      <SuperwallProvider config={testConfig} transport={transport}>
        <Paywall />
      </SuperwallProvider>,
    );
    act(() => vi.advanceTimersByTime(1));
    expect(mounts).toBe(1);

    act(() => host.update({ user: { onboarding_goal: "lose" } }));
    act(() => vi.advanceTimersByTime(1));

    expect(mounts).toBe(1);
    expect(renders.at(-1)).toBe("lose");
  });

  it("pings once and waits the same way in StrictMode", () => {
    const { transport, outgoing } = hostAnsweringAfter(200, { onboarding_goal: "endure" });
    render(
      <React.StrictMode>
        <SuperwallProvider config={testConfig} transport={transport}>
          <Paywall />
        </SuperwallProvider>
      </React.StrictMode>,
    );

    act(() => vi.advanceTimersByTime(199));
    expect(paywall()).toBeNull();
    act(() => vi.advanceTimersByTime(1));

    expect(paywall()).not.toBeNull();
    expect(renders[0]).toBe("endure");
    expect(outgoing.filter((name) => name === "ping")).toHaveLength(1);
  });

  it("stops waiting cleanly when unmounted before the host answers", () => {
    const error = vi.spyOn(console, "error");
    const { transport } = hostAnsweringAfter(300, { onboarding_goal: "build" });
    const view = render(
      <SuperwallProvider config={testConfig} transport={transport}>
        <Paywall />
      </SuperwallProvider>,
    );

    view.unmount();
    act(() => vi.advanceTimersByTime(HOST_STATE_TIMEOUT_MS * 2));

    expect(renders).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not wait on a page with no host, even with a silent transport", () => {
    window.history.replaceState({}, "", "/");
    render(
      <SuperwallProvider config={testConfig} transport={recording()}>
        <Paywall />
      </SuperwallProvider>,
    );

    expect(paywall()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
