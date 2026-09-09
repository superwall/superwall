import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenInApp } from "../../src/components/OpenInApp";

const STORAGE_KEY = "superwall-device-scheme";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("OpenInApp", () => {
  it("links straight into an app whose scheme the project knows", () => {
    const { container } = render(<OpenInApp origin="http://localhost:6100" scheme="chatgpt" />);

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "chatgpt://?superwall_dev=http%3A%2F%2Flocalhost%3A6100",
    );
  });

  it("asks for the scheme when nobody knows it, then remembers it", () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("  myapp  ");
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });

    render(<OpenInApp origin="http://localhost:6100" />);
    fireEvent.click(screen.getByRole("link"));

    expect(prompt).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("myapp://?superwall_dev=http%3A%2F%2Flocalhost%3A6100");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("myapp");
  });

  it("a cancelled or empty answer opens nothing", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    vi.spyOn(window, "prompt").mockReturnValue(null);

    render(<OpenInApp origin="http://localhost:6100" />);
    fireEvent.click(screen.getByRole("link"));
    expect(assign).not.toHaveBeenCalled();

    vi.spyOn(window, "prompt").mockReturnValue("   ");
    fireEvent.click(screen.getByRole("link"));
    expect(assign).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("uses a scheme it was told about before, over the project's", () => {
    window.localStorage.setItem(STORAGE_KEY, "remembered");

    const { container } = render(<OpenInApp origin="http://localhost:6100" scheme="fromproject" />);

    expect(container.querySelector("a")?.getAttribute("href")).toContain("remembered://");
  });

  it("survives a browser that refuses storage", () => {
    const refuse = () => {
      throw new Error("private browsing");
    };
    const getItem = vi.fn(refuse);
    const setItem = vi.fn(refuse);
    vi.stubGlobal("localStorage", { getItem, setItem });
    vi.spyOn(window, "prompt").mockReturnValue("myapp");
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });

    render(<OpenInApp origin="http://localhost:6100" />);
    fireEvent.click(screen.getByRole("link"));

    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("myapp://?superwall_dev=http%3A%2F%2Flocalhost%3A6100");
  });
});
