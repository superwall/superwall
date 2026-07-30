import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGameController, usePurchase, useSuperwallEvent } from "../../src/hooks";
import { createWrapper, flush, renderWithProvider } from "../helpers";

describe("useSuperwallEvent", () => {
  it("fires typed handlers for incoming SDK events", async () => {
    const seen: string[] = [];
    const { result } = renderWithProvider(() => {
      useSuperwallEvent("transaction_complete", (message) => {
        seen.push(message.product ?? "");
      });
      return usePurchase();
    });
    await flush();

    await act(async () => {
      await result.current.purchase("secondary");
    });

    expect(seen).toEqual(["secondary"]);
  });
});

describe("useGameController", () => {
  it("forwards controller input to handlers", async () => {
    const controllerInputs: number[] = [];

    const Consumer = () => {
      useGameController((input) => {
        if (input.directional) controllerInputs.push(input.x);
      });
      return null;
    };

    render(<Consumer />, { wrapper: createWrapper() });
    await flush();

    const paywallWindow = window as typeof window & {
      paywall?: { accept: (messages: unknown[]) => void };
    };

    act(() => {
      paywallWindow.paywall?.accept([
        {
          event_name: "game_controller_input",
          controller_element: "dpad",
          directional: true,
          x: 1,
          y: 0,
        },
      ]);
    });

    expect(controllerInputs).toEqual([1]);
  });
});
