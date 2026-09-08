import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SuperwallProvider } from "../../src";
import { PaywallRouter, useRouter, type RouteMap } from "../../src/navigation/index";
import { createHost, flush, testConfig } from "../helpers";

const Index = () => {
  const router = useRouter();
  return (
    <div>
      <span>at index</span>
      <button type="button" onClick={() => router.push("plans")}>
        To plans
      </button>
    </div>
  );
};

const Plans = () => <span>at plans</span>;

const routes: RouteMap = {
  index: { default: Index },
  plans: { default: Plans },
};

const mount = () => {
  const hosted = createHost();
  render(
    <SuperwallProvider config={testConfig} transport={hosted.transport}>
      <PaywallRouter routes={routes} navigationId="demo" />
    </SuperwallProvider>,
  );
  return hosted;
};

const pressBack = (hosted: ReturnType<typeof createHost>) =>
  act(async () => {
    hosted.host.send([{ event_name: "back_button_input" }]);
    await Promise.resolve();
    await Promise.resolve();
  });

describe("the Android back button", () => {
  it("pops a route when there is one underneath, like paywall.js", async () => {
    const hosted = mount();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "To plans" }));
    expect(screen.getByText("at plans")).toBeDefined();

    await pressBack(hosted);

    expect(screen.getByText("at index")).toBeDefined();
    expect(hosted.delegate.events.some((event) => event.event_name === "close")).toBe(false);
  });

  it("closes the paywall at the root, so the host sees a decline", async () => {
    const hosted = mount();
    await flush();

    await pressBack(hosted);

    expect(hosted.delegate.events.some((event) => event.event_name === "close")).toBe(true);
  });
});
