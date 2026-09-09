import { useMediaQuery } from "./useMediaQuery";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type SuperwallColorScheme = "light" | "dark";

/**
 * Light or dark, as the host reports it; the OS preference stands in when
 * the host says nothing. `SuperwallProvider` already puts this on `<html>`
 * as a `dark` class and `color-scheme`, so plain CSS works without it.
 */
export const useColorScheme = (): SuperwallColorScheme => {
  const { device } = useSuperwallSnapshot();
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  const reported = device.interfaceStyle?.toLowerCase();
  if (reported === "dark") return "dark";
  if (reported === "light") return "light";
  return prefersDark ? "dark" : "light";
};
