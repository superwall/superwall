import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildPreviewPath } from "../src/lib/preview";
import { StudioApp } from "../src/StudioApp";
import type { StudioSource } from "../src/lib/types";

const source: StudioSource = {
  title: "chatgpt",
  surfaces: [
    {
      kind: "paywall",
      id: "plus-upgrade",
      pageRoutes: ["/"],
      locales: ["en", "es"],
      variables: { defaultPlan: { type: "enum", values: ["go", "plus"], default: "plus" } },
      paywallId: "208540",
    },
    { kind: "funnel", id: "onboarding", pageRoutes: ["/", "/step-2"], locales: ["en"] },
  ],
  diagnostics: [],
  previewUrl: buildPreviewPath,
};

describe("StudioApp", () => {
  it("lists surfaces grouped by kind with live miniatures", () => {
    render(<StudioApp source={source} />);

    expect(screen.getByText("chatgpt")).toBeDefined();
    expect(screen.getByText("Paywalls")).toBeDefined();
    expect(screen.getByText("Funnels")).toBeDefined();
    expect(screen.getByText("plus-upgrade")).toBeDefined();
    expect(screen.getByText("onboarding")).toBeDefined();
    const card = screen.getByText("plus-upgrade").closest("a");
    expect(card?.getAttribute("href")).toBe("/paywall/plus-upgrade");
  });

  it("opens the editor on card click with the bottom toolbar", () => {
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByText("plus-upgrade"));
    expect(window.location.pathname).toBe("/paywall/plus-upgrade");
    expect(screen.getByRole("combobox", { name: "Device" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Theme" })).toBeDefined();
    // no context badges on the stage — the paywall stands alone
    expect(screen.queryByText("#208540")).toBeNull();
    expect(screen.getByLabelText("Device")).toBeDefined();
    // the open control pops a device-sized preview window
    const opener = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Open preview" }));
    expect(String(opener.mock.calls[0]?.[0])).toContain("/preview/paywall/plus-upgrade");
    expect(String(opener.mock.calls[0]?.[2])).toContain("width=402");
    opener.mockRestore();

    // the wordmark navigates home
    fireEvent.click(screen.getByText("Studio"));
    expect(window.location.pathname).toBe("/");
    expect(screen.getByText("Paywalls")).toBeDefined();
  });

  it("deep-links straight into the editor", () => {
    window.history.replaceState({}, "", "/funnel/onboarding");
    render(<StudioApp source={source} />);

    expect(screen.getByRole("combobox", { name: "Device" })).toBeDefined();
    // no variables declared → no Variables button, no panel
    expect(screen.queryByRole("button", { name: /Variables/ })).toBeNull();
    // single locale → no locale select
    expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull();
  });

  it("responsive mode exposes editable dimensions that drive the frame", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    // device presets show no size inputs
    expect(screen.queryByRole("spinbutton", { name: "Preview width" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Device" }), {
      target: { value: "responsive" },
    });
    const width = screen.getByRole("spinbutton", { name: "Preview width" });
    // free typing below the minimum stays put until focus leaves
    fireEvent.change(width, { target: { value: "6" } });
    expect((width as HTMLInputElement).value).toBe("6");
    fireEvent.change(width, { target: { value: "600" } });
    fireEvent.blur(width);
    // double-buffered: the newest frame carries the new size
    const frame = screen.getAllByTitle("plus-upgrade preview").at(-1);
    expect(frame?.getAttribute("width")).toBe("600");
    // responsive is layout-only: no simulated hardware in the preview URL
    expect(frame?.getAttribute("src")).not.toContain("sw_device");
  });

  it("edits variables in the side panel and keeps overrides in the preview URL", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    // controls live in the panel, opened from the toolbar
    expect(screen.queryByRole("combobox", { name: "defaultPlan" })).toBeNull();
    const toggle = screen.getByRole("button", { name: /Variables/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.change(screen.getByRole("combobox", { name: "defaultPlan" }), {
      target: { value: "go" },
    });
    const frame = screen.getAllByTitle("plus-upgrade preview").at(-1);
    expect(frame?.getAttribute("src")).toContain(encodeURIComponent('{"defaultPlan":"go"}'));

    fireEvent.click(screen.getByRole("button", { name: "Close variables" }));
    expect(screen.queryByRole("combobox", { name: "defaultPlan" })).toBeNull();
  });
});
