import * as React from "react";
import {
  detectPreviewOptIn,
  mockProductsFromConfig,
  type SuperwallConfig,
  type SuperwallMockOptions,
} from "@superwall/runtime";
import { SuperwallProvider } from "../provider/context";
import {
  applyThemeOverride,
  mergePreviewSearch,
  readPreviewOverrides,
  type PreviewOverrides,
} from "./overrides";
import { announceToStudio, studioBridge } from "./studio-bridge";

declare global {
  interface Window {
    __swPreviewApply?: (search: string) => void;
  }
}

export const previewMockOptions = (
  overrides: PreviewOverrides,
  config: SuperwallConfig,
): SuperwallMockOptions => {
  const { theme, locale, device, user, params, products, trialEligible } = overrides;

  const languageCode = locale?.split(/[-_]/)[0];

  const priced = products
    ? mockProductsFromConfig(config).map((product) => {
        const patch = products[product.reference];
        return patch ? { ...product, variables: { ...product.variables, ...patch } } : product;
      })
    : undefined;

  return {
    ...studioBridge(),
    ...(priced ? { products: priced } : {}),
    ...(trialEligible === undefined ? {} : { trialEligible }),
    ...(user ? { user } : {}),
    ...(params ? { params } : {}),
    device: {
      ...device,
      ...(locale ? { deviceLocale: locale, deviceLanguageCode: languageCode } : {}),
      ...(theme ? { interfaceStyle: theme === "dark" ? "Dark" : "Light" } : {}),
    },
  };
};

export const usePreviewOverrides = (): PreviewOverrides => {
  const [overrides, setOverrides] = React.useState(() => {
    const initial = readPreviewOverrides(window.location.search);
    applyThemeOverride(initial.theme);
    return initial;
  });

  React.useEffect(() => {
    window.__swPreviewApply = (search: string) => {
      const query = mergePreviewSearch(window.location.search, search);
      window.history.replaceState(null, "", `${window.location.pathname}${query}`);
      const next = readPreviewOverrides(query);
      applyThemeOverride(next.theme);
      setOverrides(next);
    };
    return () => {
      delete window.__swPreviewApply;
    };
  }, []);

  return overrides;
};

export const useStudioAnnouncement = (config: SuperwallConfig): void => {
  const locales = Object.keys(config.localization?.messages ?? {}).join(",");
  React.useEffect(() => {
    announceToStudio({ locales: locales === "" ? [] : locales.split(",") });
  }, [locales]);
};

const SimulatedHost = ({
  config,
  children,
}: React.PropsWithChildren<{ config: SuperwallConfig }>) => {
  const overrides = usePreviewOverrides();
  useStudioAnnouncement(config);
  return (
    <SuperwallProvider config={config} mock={previewMockOptions(overrides, config)}>
      {children}
    </SuperwallProvider>
  );
};

export const PreviewHost = ({
  config,
  children,
}: React.PropsWithChildren<{ config: SuperwallConfig }>) =>
  detectPreviewOptIn() ? (
    <SimulatedHost config={config}>{children}</SimulatedHost>
  ) : (
    <SuperwallProvider config={config} mock="auto">
      {children}
    </SuperwallProvider>
  );
