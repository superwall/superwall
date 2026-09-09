import * as React from "react";

const subscribe = (query: string, onChange: () => void): (() => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(query);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
};

const matches = (query: string): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(query).matches;

export const useMediaQuery = (query: string): boolean =>
  React.useSyncExternalStore(
    React.useCallback((onChange) => subscribe(query, onChange), [query]),
    () => matches(query),
    () => false,
  );
