import * as React from "react";
import { useColorScheme } from "../hooks/useColorScheme";
import {
  backgroundOf,
  createSuperwallSession,
  detectSuperwallHost,
  INSET_EDGES,
  insetsOf,
  pendingHostMessages,
  type ITransport,
  type SuperwallConfig,
  type SuperwallProduct,
  type SuperwallProductVariables,
  type SuperwallSession,
  type ResolvedBackground,
} from "@superwall/runtime";
import { documentAttributes, HOST_ATTRIBUTE_NAMES, hostAttributes } from "../document";
import { useSuperwallSnapshot } from "../hooks/useSuperwallSnapshot";
import "./insets.css";

const SuperwallContext = React.createContext<SuperwallSession | null>(null);
const HostStateContext = React.createContext(true);

/** How long a surface with `entry` waits for its host's first state before rendering without it. Nothing else waits. */
export const HOST_STATE_TIMEOUT_MS = 3000;

const useHostState = (session: SuperwallSession): boolean => {
  const [arrived, setArrived] = React.useState(() => !detectSuperwallHost());

  React.useLayoutEffect(() => {
    if (arrived) return;
    const arrive = () => setArrived(true);
    const timer = setTimeout(arrive, HOST_STATE_TIMEOUT_MS);
    const off = session.on("template_variables", arrive);
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [arrived, session]);

  return arrived;
};

export type SuperwallProviderProps = React.PropsWithChildren<{
  config?: SuperwallConfig;
  transport?: ITransport;
  inlineProducts?: Readonly<Record<string, SuperwallProductVariables>>;
}>;

export const SuperwallProvider = ({
  children,
  config,
  transport,
  inlineProducts,
}: SuperwallProviderProps) => {
  const ownedSession = React.useRef<SuperwallSession | null>(null);
  const ownedTransport = React.useRef<ITransport | undefined>(undefined);

  if (ownedSession.current === null || ownedTransport.current !== transport) {
    ownedTransport.current = transport;
    ownedSession.current = createSuperwallSession({ config, transport, inlineProducts });
  }

  const value = ownedSession.current;

  React.useLayoutEffect(() => {
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

  const ready = useHostState(value);

  // Begin listening and send the handshake ping, once per session. A single
  // `start()` call: the session ignores a repeat once it is listening.
  const pingedSession = React.useRef<SuperwallSession | null>(null);
  React.useLayoutEffect(() => {
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
    for (const [name, attribute] of Object.entries(documentAttributes(config))) {
      document.documentElement.setAttribute(name, attribute);
    }
  }, [config]);

  return React.createElement(
    SuperwallContext.Provider,
    { value },
    React.createElement(ColorScheme, { background: backgroundOf(config?.background) }),
    React.createElement(HostAttributes),
    React.createElement(Insets, { insets: config?.insets }),
    React.createElement(HostStateContext.Provider, { value: ready }, children),
  );
};

const Insets = ({ insets }: { insets: SuperwallConfig["insets"] }): null => {
  React.useEffect(() => {
    const resolved = insetsOf(insets);
    const style = document.documentElement.style;
    for (const edge of INSET_EDGES) {
      const value = resolved[edge];
      if (value === undefined) style.removeProperty(`--sw-inset-${edge}`);
      else style.setProperty(`--sw-inset-${edge}`, value);
    }
  }, [insets]);

  return null;
};

const HostAttributes = (): null => {
  const { device } = useSuperwallSnapshot();

  React.useEffect(() => {
    const root = document.documentElement;
    const attributes = hostAttributes(device);
    for (const name of HOST_ATTRIBUTE_NAMES) {
      const value = attributes[name];
      if (value === undefined) root.removeAttribute(name);
      else root.setAttribute(name, value);
    }
    // The platform stylesheet pins `cursor: default` on everything outside a
    // web2app body. A web host (the Web SDK's frame) has to opt in itself: the
    // host page cannot reach this cross-origin document.
    document.body.classList.toggle("web2app", attributes["data-sw-platform"] === "web");

    const insets = device.safeAreaInsets;
    for (const edge of INSET_EDGES) {
      const value = insets?.[edge];
      if (typeof value === "number")
        root.style.setProperty(`--sw-safe-area-floor-${edge}`, `${value}px`);
      else root.style.removeProperty(`--sw-safe-area-floor-${edge}`);
    }
  }, [device]);

  return null;
};

const ColorScheme = ({ background }: { background?: ResolvedBackground }): null => {
  const scheme = useColorScheme();

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", scheme === "dark");
    root.classList.toggle("light", scheme === "light");
    root.style.colorScheme = scheme;
    if (background) {
      root.style.backgroundColor =
        scheme === "dark" ? (background.dark ?? background.light) : background.light;
    }
  }, [scheme, background]);

  return null;
};

export const useHostStateArrived = (): boolean => React.useContext(HostStateContext);

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
