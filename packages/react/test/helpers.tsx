import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { defineSuperwallConfig } from "@superwall/runtime";
import { SuperwallProvider, type SuperwallProviderProps } from "../src";

export const testConfig = defineSuperwallConfig({
  products: {
    primary: "pro_3999_year",
    secondary: "pro_999_month",
  },
  localization: {
    defaultLocale: "en",
    messages: {
      en: { paywall: { title: "Go Pro" } },
      de: { paywall: { title: "Hol dir Pro" } },
    },
  },
});

export const createWrapper = (props: Partial<SuperwallProviderProps> = {}) => {
  return ({ children }: React.PropsWithChildren) => (
    <SuperwallProvider config={testConfig} mock {...props}>
      {children}
    </SuperwallProvider>
  );
};

export const renderWithProvider = <T,>(
  hook: () => T,
  props: Partial<SuperwallProviderProps> = {},
) => renderHook(hook, { wrapper: createWrapper(props) });

/** Flushes the mock host's microtask-delivered replies inside act. */
export const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
