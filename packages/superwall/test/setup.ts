import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  if (typeof window === "undefined") return;
  cleanup();
  window.history.replaceState({}, "", "/");
});
