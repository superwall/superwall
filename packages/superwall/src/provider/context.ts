import * as React from "react";
import { useColorScheme } from "../hooks/useColorScheme";
import {
  createMockSuperwallTransport,
  createSuperwallSession,
  detectNativeSuperwallHost,
  detectPreviewOptIn,
  documentAttributes,
  mockOptionsFromConfig,
  pendingHostMessages,
  type SuperwallMockOptions,
  type SuperwallConfig,
  type SuperwallProduct,
  type SuperwallSession,
} from "@superwall/runtime";

const SuperwallContext = React.createContext<SuperwallSession | null>(null);

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * How the provider gets its runtime data. `"auto"` (what the build emits)
 * runs against the real host and simulates *only* when the page opts in with
 * `?sw_preview` — so a snapshot behaves identically in a webview and in a
 * preview with no code change, and can never quietly downgrade itself to fake
 * products when a real host is merely slow to appear. An options object
 * supplies preview data; only `true` forces the mock even inside a real host.
 */
export type SuperwallMockProp = boolean | "auto" | SuperwallMockOptions;

/**
 * The framework mounts this — users write hooks, not the provider, and it is
 * exported only so the generated build entry can import it. `config` and
 * `mock` are the whole surface; the session always starts, exposes its
 * native interface, and pings.
 */
export type SuperwallProviderProps = React.PropsWithChildren<{
  config?: SuperwallConfig;
  mock?: SuperwallMockProp;
}>;

const resolveMockOptions = (
  mock: SuperwallMockProp | undefined,
  config: SuperwallConfig | undefined,
): SuperwallMockOptions | undefined => {
  if (!mock) return undefined;
  // `true` is an explicit instruction, honoured even inside a real host.
  if (mock === true) return mockOptionsFromConfig(config, {});
  // A real host always wins over any non-forced request to simulate.
  if (detectNativeSuperwallHost()) return undefined;
  // `"auto"` ships in every built snapshot, so it must never be the reason a
  // production paywall starts serving placeholder products — it simulates only
  // when the page explicitly asks. Options objects come from preview surfaces
  // that have already decided, so they stand on their own.
  if (mock === "auto" && !detectPreviewOptIn()) return undefined;
  return mockOptionsFromConfig(config, typeof mock === "object" ? mock : {});
};

/**
 * Compared by value, not identity: the studio hands down a freshly built mock
 * object on every render, and only a real change of simulated device, locale or
 * products should cost a new session. Functions drop out of the comparison, so
 * a new callback identity is not a change.
 */
const describeMock = (mock: SuperwallMockProp | undefined): string => {
  if (mock === undefined) return "none";
  if (typeof mock !== "object") return String(mock);
  try {
    return JSON.stringify(mock);
  } catch {
    return "unserializable";
  }
};

export const SuperwallProvider = ({ children, config, mock }: SuperwallProviderProps) => {
  const ownedSession = React.useRef<SuperwallSession | null>(null);
  const ownedMock = React.useRef<string | null>(null);
  const signature = describeMock(mock);

  if (ownedSession.current === null || ownedMock.current !== signature) {
    ownedMock.current = signature;
    const mockOptions = resolveMockOptions(mock, config);
    ownedSession.current = createSuperwallSession({
      config,
      transport: mockOptions ? createMockSuperwallTransport(mockOptions) : undefined,
    });
  }

  const value = ownedSession.current;

  // Expose the interface the native SDK calls into to deliver messages
  // (`window.paywall.accept`), before paint so nothing is dropped.
  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") {
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
      accept: value.accept.bind(value),
      accept64: value.accept64.bind(value),
      messages: pendingHostMessages(),
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
  }, [value]);

  // Begin listening and send the handshake ping, once per session. A single
  // `start()` call: the session ignores a repeat once it is listening.
  const pingedSession = React.useRef<SuperwallSession | null>(null);
  React.useEffect(() => {
    const firstStart = pingedSession.current !== value;
    value.start({ sendPing: firstStart });
    if (firstStart) {
      pingedSession.current = value;
    }
  }, [value]);

  React.useEffect(() => {
    if (config) {
      value.configure(config);
    }
  }, [config, value]);

  // Document semantics (`data-sw-*`) on <html>; the platform stylesheet reads
  // them. In dev there is no build step, so the provider reasserts them.
  React.useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    for (const [name, attribute] of Object.entries(documentAttributes(config))) {
      document.documentElement.setAttribute(name, attribute);
    }
  }, [config]);

  return React.createElement(
    SuperwallContext.Provider,
    { value },
    React.createElement(ColorScheme, null),
    children,
  );
};

/**
 * Puts the SDK's colour scheme on `<html>` so a paywall can be styled with
 * plain CSS. A media query cannot do this job: hosts report the device's
 * setting over the bridge, and the studio simulates it, neither of which
 * changes what `prefers-color-scheme` evaluates to.
 */
const ColorScheme = (): null => {
  const scheme = useColorScheme();

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", scheme === "dark");
    root.classList.toggle("light", scheme === "light");
    root.style.colorScheme = scheme;
  }, [scheme]);

  return null;
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
