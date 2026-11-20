import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { SuperwallProvider } from "../../src";
import { PaywallRouter, TRANSITION_MS, useRouter, type RouteMap } from "../../src/navigation/index";
import { createHost, flush, testConfig } from "../helpers";

const Step = ({ name, next }: { name: string; next?: string }) => {
  const router = useRouter();
  return (
    <div>
      <span>at {name}</span>
      {next ? (
        <button type="button" onClick={() => router.push(next)}>
          To {next}
        </button>
      ) : null}
    </div>
  );
};

const routes: RouteMap = {
  index: { default: () => <Step name="index" next="goals" /> },
  goals: { default: () => <Step name="goals" next="plans" />, transition: "slide" },
  plans: { default: () => <Step name="plans" /> },
};

let sent: TOutgoingMessage[] = [];

const mount = async () => {
  sent = [];
  const { transport } = createHost({ onOutgoing: (message) => sent.push(message) });
  render(
    <SuperwallProvider config={testConfig} transport={transport}>
      <PaywallRouter routes={routes} navigationId="onboarding" />
    </SuperwallProvider>,
  );
  await flush();
  return {
    press: () => act(() => transport.accept({ event_name: "back_button_input" })),
  };
};

const settle = () => act(() => vi.advanceTimersByTime(TRANSITION_MS));

const go = (label: string) => {
  fireEvent.click(screen.getByText(label));
  settle();
};

const closes = () => sent.filter((message) => message.event_name === "close").length;

const at = () =>
  document.querySelector('[data-sw-state="active"]')?.getAttribute("data-sw-route") ?? undefined;

beforeEach(() => vi.useFakeTimers());

describe("Android system back (back_button_input)", () => {
  it("steps back one route with the leaving route's transition", async () => {
    const { press } = await mount();
    go("To goals");
    go("To plans");
    expect(at()).toBe("plans");

    press();
    expect(at()).toBe("goals");
    expect(document.querySelector('[data-sw-route="plans"]')?.getAttribute("data-sw-state")).toBe(
      "exiting",
    );
    settle();

    press();
    settle();
    expect(at()).toBe("index");
    expect(closes()).toBe(0);
  });

  it("closes the paywall at the first route", async () => {
    const { press } = await mount();
    press();
    expect(closes()).toBe(1);
    expect(at()).toBe("index");
  });

  it("ignores a press while a route transition runs", async () => {
    const { press } = await mount();
    go("To goals");
    fireEvent.click(screen.getByText("To plans"));

    press();
    expect(at()).toBe("plans");
    settle();

    press();
    press();
    expect(at()).toBe("goals");
    settle();
    expect(at()).toBe("goals");
    expect(closes()).toBe(0);
  });
});
