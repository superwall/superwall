import * as React from "react";
import { completedWebCheckout, readCompletedWebCheckout } from "../redemption";

type RuntimeController = {
  completeWebCheckout?: (input: unknown) => void;
};

export const useWebCheckoutBridge = () => {
  React.useEffect(() => {
    const holder = window as typeof window & {
      __sw_runtime_controller?: RuntimeController;
    };
    const previous = holder.__sw_runtime_controller;
    const controller: RuntimeController = {
      ...previous,
      completeWebCheckout: (input) => {
        completedWebCheckout.set(readCompletedWebCheckout(input));
      },
    };
    holder.__sw_runtime_controller = controller;
    return () => {
      if (holder.__sw_runtime_controller === controller) {
        holder.__sw_runtime_controller = previous;
      }
    };
  }, []);
};
