// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransportLogger } from "../src/transport/shared";

afterEach(() => {
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
