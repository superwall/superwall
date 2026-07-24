import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  // vitest runs without injected globals, so testing-library's automatic
  // cleanup never registers — do it explicitly.
  cleanup();
  window.history.replaceState({}, "", "/");
});
