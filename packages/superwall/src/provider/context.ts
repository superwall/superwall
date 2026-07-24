import * as React from "react";
import {
  createMockSuperwallTransport,
  createSuperwallSession,
  detectNativeSuperwallHost,
  documentAttributes,
  mockOptionsFromConfig,
  type SuperwallMockOptions,
  type SuperwallConfig,
  type SuperwallProduct,
  type SuperwallSession,
  type SuperwallSessionStartOptions,
} from "@superwall/runtime";

const SuperwallContext = React.createContext<SuperwallSession | null>(null);

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export type SuperwallMockProp = boolean | "auto" | SuperwallMockOptions;

export type SuperwallProviderProps<TProduct extends SuperwallProduct = SuperwallProduct> =
  React.PropsWithChildren<{
    session?: SuperwallSession<TProduct>;
    config?: SuperwallConfig;
    mock?: SuperwallMockProp;
    autoStart?: boolean;
    exposePaywallInterface?: boolean;
    ping?: SuperwallSessionStartOptions["ping"];
  }>;

const resolveMockOptions = (
  mock: SuperwallMockProp | undefined,
  config: SuperwallConfig | undefined,
): SuperwallMockOptions | undefined => {
  if (!mock) return undefined;
  if (mock !== true && detectNativeSuperwallHost()) return undefined;
  return mockOptionsFromConfig(config, typeof mock === "object" ? mock : {});
};

export const SuperwallProvider = <TProduct extends SuperwallProduct = SuperwallProduct>({
  children,
  session,
  config,
  mock,
  autoStart = true,
  exposePaywallInterface = true,
  ping,
}: SuperwallProviderProps<TProduct>) => {
  const ownedSession = React.useRef<SuperwallSession<TProduct> | null>(null);

  if (!session && ownedSession.current === null) {
    const mockOptions = resolveMockOptions(mock, config);

    ownedSession.current = createSuperwallSession<TProduct>({
      config,
      transport: mockOptions ? createMockSuperwallTransport(mockOptions) : undefined,
    });
  }

  const value = session ?? ownedSession.current;

  if (!value) {
    throw new Error("SuperwallProvider could not create a runtime session");
  }

  useIsomorphicLayoutEffect(() => {
    if (!exposePaywallInterface || typeof window === "undefined") {
      return;
    }

    const paywallWindow = window as typeof window & {
      paywall?: unknown;
      app?: unknown;
      __sw_runtime_session?: unknown;
    };

    const previousPaywall = paywallWindow.paywall;
    const previousApp = paywallWindow.app;
    const previousRuntimeSession = paywallWindow.__sw_runtime_session;
    const paywallInterface = {
      accept: value.accept.bind(value),
      accept64: value.accept64.bind(value),
    };
    const appInterface = {
      getAllState: () => value.getSnapshot().state,
    };

    paywallWindow.paywall = paywallInterface;
    paywallWindow.app = appInterface;
    paywallWindow.__sw_runtime_session = value;

    return () => {
      if (paywallWindow.paywall === paywallInterface) {
        paywallWindow.paywall = previousPaywall;
      }
      if (paywallWindow.app === appInterface) {
        paywallWindow.app = previousApp;
      }
      if (paywallWindow.__sw_runtime_session === value) {
        paywallWindow.__sw_runtime_session = previousRuntimeSession;
      }
    };
  }, [exposePaywallInterface, value]);

  const pingedSession = React.useRef<SuperwallSession<TProduct> | null>(null);
  React.useEffect(() => {
    if (!autoStart) {
      return;
    }
    const firstStart = pingedSession.current !== value;
    value.start({ sendPing: firstStart, ping });
    if (firstStart) {
      pingedSession.current = value;
    }
  }, [autoStart, ping, value]);

  React.useEffect(() => {
    if (config) {
      value.configure(config);
    }
  }, [config, value]);

  React.useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    for (const [name, attribute] of Object.entries(documentAttributes(config))) {
      document.documentElement.setAttribute(name, attribute);
    }
  }, [config]);

  // The session type is covariant in its product generic, so a refined
  // session stores into the base-typed context directly.
  return React.createElement(SuperwallContext.Provider, { value }, children);
};

export const useSuperwallSession = <
  TProduct extends SuperwallProduct = SuperwallProduct,
>(): SuperwallSession<TProduct> => {
  const session = React.useContext(SuperwallContext);

  if (!session) {
    throw new Error("Superwall hooks must be used within a SuperwallProvider");
  }

  // The context stores the base-typed session; this reapplies the caller's
  // custom-variables claim (typed `createSuperwall<T>()` bundles) — the same
  // unverifiable-claim seam as `createSuperwallSession`. Every typed hook
  // derives from this one downcast.
  return session as SuperwallSession<TProduct>;
};
