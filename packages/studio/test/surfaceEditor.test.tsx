import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SurfaceEditor } from "../src/screens/SurfaceEditor";
import { STUDIO_CHANNEL } from "../src/lib/events";
import { snapshotPreviewUrl } from "../src/lib/preview";
import type { StudioSource, StudioSurface } from "../src/lib/types";

/**
 * The hosted shape: one paywall, several sealed versions, each a surface with
 * a label, previewed straight from its published snapshot.
 */
const live: StudioSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  label: "v12 · live",
  routes: [],
  locales: [],
  products: { annual: "pro_5999_year" },
};
const pushed: StudioSurface = { ...live, label: "v13" };

const source: StudioSource = {
  title: "Plus Upgrade",
  surfaces: [pushed, live],
  compareHint: "Published snapshot",
  previewUrl: snapshotPreviewUrl((surface) =>
    surface === live ? "https://cdn.test/v12.html" : "https://cdn.test/v13.html",
  ),
};

const announce = (locales: unknown) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { channel: STUDIO_CHANNEL, type: "hello", locales } }),
    );
  });

const preview = (): HTMLIFrameElement => {
  const frames = screen.getAllByTitle("plus-upgrade preview");
  const last = frames[frames.length - 1];
  if (!(last instanceof HTMLIFrameElement)) throw new Error("no preview frame");
  return last;
};

describe("SurfaceEditor hosting a published paywall", () => {
  it("previews the snapshot the host resolves, opted into simulation", () => {
    render(<SurfaceEditor source={source} surface={live} samples={{}} onBack={() => {}} />);
    const url = new URL(preview().src);
    expect(`${url.origin}${url.pathname}`).toBe("https://cdn.test/v12.html");
    expect(url.searchParams.get("sw_preview")).toBe("1");
    expect(url.searchParams.get("theme")).toBe("light");
    expect(screen.getByText("Plus Upgrade / plus-upgrade · v12 · live")).toBeTruthy();
  });

  it("learns the paywall's locales from the running snapshot when the host knows none", () => {
    render(<SurfaceEditor source={source} surface={live} samples={{}} onBack={() => {}} />);
    expect(screen.queryByLabelText("Locale")).toBeNull();

    announce(["en", "de"]);

    const select = screen.getByLabelText("Locale") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "de" } });
    expect(new URL(preview().src).searchParams.get("locale")).toBe("de");
  });

  it("trusts what the host says over the snapshot when both know locales", () => {
    render(
      <SurfaceEditor
        source={source}
        surface={{ ...live, locales: ["en", "fr"] }}
        samples={{}}
        onBack={() => {}}
      />,
    );
    announce(["en", "de"]);
    const options = [...(screen.getByLabelText("Locale") as HTMLSelectElement).options].map(
      (option) => option.value,
    );
    expect(options).toEqual(["default", "en", "fr"]);
  });

  it("offers the other versions to compare against, named by the host", () => {
    render(<SurfaceEditor source={source} surface={live} samples={{}} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(screen.getByText("Published snapshot")).toBeTruthy();
    expect(screen.queryByText("v12 · live")).toBeNull();
    fireEvent.click(screen.getByText("v13"));

    expect(preview().src).toContain("v12.html");
    const compared = screen.getByTitle("v13 preview");
    expect(compared).toBeInstanceOf(HTMLIFrameElement);
    if (compared instanceof HTMLIFrameElement) expect(compared.src).toContain("v13.html");
  });

  it("puts the host's own controls in the top bar", () => {
    render(
      <SurfaceEditor
        source={source}
        surface={live}
        samples={{}}
        onBack={() => {}}
        actions={<button type="button">Version</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Version" })).toBeTruthy();
  });
});
