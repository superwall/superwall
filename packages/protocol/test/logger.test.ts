// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransportLogger } from "../src/transport/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createTransportLogger", () => {
  it("prints info, warn and error, and debug only behind the localStorage flag", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createTransportLogger("Something");

    logger.debug("quiet");
    expect(log).not.toHaveBeenCalled();

    localStorage.setItem("SW_DEBUG_TRANSPORT", "true");
    logger.debug("loud", { detail: 1 });
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(log).toHaveBeenCalledWith(
      "%c[Something]%c loud",
      "color: #999; font-weight: bold",
      "color: inherit",
      { detail: 1 },
    );
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when storage access throws, as in a sandboxed frame", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    createTransportLogger("Something").debug("quiet");
    expect(log).not.toHaveBeenCalled();
  });

  it("still logs when localStorage is null, as in the Android SDK's WebView", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("localStorage", null);
    const logger = createTransportLogger("Android");
    expect(() => logger.info("sent")).not.toThrow();
    logger.debug("quiet");
    expect(info).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("colours known transports", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    createTransportLogger("WebKit").info("hi");
    expect(info).toHaveBeenCalledWith(
      "%c[WebKit]%c hi",
      "color: #9C27B0; font-weight: bold",
      "color: inherit",
    );
  });
});
