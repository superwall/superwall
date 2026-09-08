import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import {
  createHostTransport,
  recordingDelegate,
  type DelegateAnswers,
  type HostProduct,
  type HostStatePatch,
  type HostVariables,
  type RecordingDelegate,
} from "@superwall/host";
import type { SuperwallConfig, TOutgoingMessage } from "@superwall/runtime";
import { SuperwallProvider } from "../src";

export const testConfig: SuperwallConfig = {
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
};

export const testDevice: HostVariables = {
  platform: "iOS",
  deviceLocale: "en_US",
  deviceLanguageCode: "en",
  interfaceStyle: "Light",
};

export const testProducts: HostProduct[] = [
  { reference: "primary", productId: "pro_3999_year", variables: {} },
  { reference: "secondary", productId: "pro_999_month", variables: {} },
];

export type HostProps = Omit<HostStatePatch, "products"> &
  DelegateAnswers & {
    products?: readonly { reference: string; productId: string; variables?: HostVariables }[];
    onOutgoing?: (message: TOutgoingMessage) => void;
  };

export type WrapperProps = {
  config?: SuperwallConfig;
  host?: HostProps;
};

export const createHost = ({
  onOutgoing,
  purchase,
  restore,
  permission,
  callback,
  products,
  device,
  ...state
}: HostProps = {}) => {
  const delegate: RecordingDelegate = recordingDelegate({
    purchase,
    restore,
    permission,
    callback,
  });
  const event = delegate.event;
  delegate.event = (message) => {
    event(message);
    onOutgoing?.(message);
  };
  const { transport, host } = createHostTransport({
    state: {
      products: (products ?? testProducts).map((product) => ({ variables: {}, ...product })),
      device: { ...testDevice, ...device },
      ...state,
    },
    delegate,
  });
  return { transport, host, delegate };
};

export const createWrapper = (props: WrapperProps = {}) => {
  const { transport } = createHost(props.host);
  return ({ children }: React.PropsWithChildren) => (
    <SuperwallProvider config={props.config ?? testConfig} transport={transport}>
      {children}
    </SuperwallProvider>
  );
};

export const renderWithProvider = <T,>(hook: () => T, props: WrapperProps = {}) =>
  renderHook(hook, { wrapper: createWrapper(props) });

/** Flushes the host's microtask-delivered replies inside act. */
export const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
