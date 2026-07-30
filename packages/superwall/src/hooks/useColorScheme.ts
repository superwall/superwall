import * as React from "react";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type SuperwallColorScheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const subscribe = (onChange: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const systemPrefersDark = () =>
  typeof window !== "undefined" && !!window.matchMedia?.(DARK_QUERY).matches;

/**
 * Whether this paywall should render light or dark, as the SDK reports it.
 *
 * The device's own setting wins, because that is what the person is actually
 * looking at; where a host says nothing, the OS preference stands in.
 *
 * ```tsx
 * const scheme = useColorScheme()
 * ```
 *
 * You rarely need to call this — `SuperwallProvider` already puts the scheme on
 * `<html>` as a `dark` class and `color-scheme`, so plain CSS
 * (`:root.dark { … }`) works without any wiring.
 */
export const useColorScheme = (): SuperwallColorScheme => {
  const { device } = useSuperwallSnapshot();
  const prefersDark = React.useSyncExternalStore(subscribe, systemPrefersDark, () => false);

  const reported = device.interfaceStyle?.toLowerCase();
  if (reported === "dark") return "dark";
  if (reported === "light") return "light";
  return prefersDark ? "dark" : "light";
};
