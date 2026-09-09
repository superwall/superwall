import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceEditor } from "../../src/screens/SurfaceEditor";
import { snapshotPreviewUrl } from "../../src/lib/preview";
import type { StudioSource, StudioSurface } from "../../src/lib/surfaces";

/**
 * The hosted shape: one paywall, several sealed versions, each a surface with
 * a label, previewed straight from its published snapshot and hosted by the
 * studio the way the visual editor hosts a paywall.js document.
 */
const live: StudioSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  label: "v12 · live",
  routes: [],
  locales: [],
  products: { annual: "pro_5999_year" },
  paywallId: "208540",
  paywallIdentifier: "plus_upgrade",
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

const preview = (): HTMLIFrameElement => {
  const frames = screen.getAllByTitle("plus-upgrade preview");
  const last = frames[frames.length - 1];
  if (!(last instanceof HTMLIFrameElement)) throw new Error("no preview frame");
  return last;
};

const hostOf = (frame: HTMLIFrameElement) => {
  if (!frame.contentWindow) throw new Error("iframe without a window");
  const target = frame.contentWindow;
  const post = vi.spyOn(target, "postMessage").mockImplementation(() => {});
  const ping = () =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            version: 1,
            direction: "from_paywall",
            payload: { events: [{ event_name: "ping", substitutions: [], page_styles: [] }] },
          }),
          source: target,
        }),
      );
    });
  const sent = () =>
    post.mock.calls.map(([message]) => {
      if (typeof message !== "string") throw new Error("host must post strings");
      const envelope: { payload: { events: Record<string, unknown>[] } } = JSON.parse(message);
      return envelope.payload.events;
    });
  return { ping, sent };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SurfaceEditor hosting a published paywall", () => {
  it("previews the snapshot the host resolves, over the editor transport", () => {
    render(<SurfaceEditor source={source} surface={live} samples={{}} onBack={() => {}} />);
    const url = new URL(preview().src);
    expect(`${url.origin}${url.pathname}`).toBe("https://cdn.test/v12.html");
    expect(url.searchParams.get("transport")).toBe("editor");
    expect(url.searchParams.has("sw_preview")).toBe(false);
    expect(url.searchParams.has("theme")).toBe(false);
    expect(screen.getByText("Plus Upgrade / plus-upgrade · v12 · live")).toBeTruthy();
  });

  it("answers the paywall's ping with the version's products and identity", () => {
    render(
      <SurfaceEditor
        source={source}
        surface={live}
        samples={{ products: { pro_5999_year: { price: "$59.99", trialPeriodDays: 7 } } }}
        onBack={() => {}}
      />,
    );
    const host = hostOf(preview());
    host.ping();

    const [burst] = host.sent();
    expect(burst?.map((event) => event.event_name)).toEqual([
      "template_variables",
      "experiment",
      "products",
      "template_substitutions_prefix",
      "paywall_open",
    ]);
    expect(burst?.[0]).toMatchObject({
      variables: {
        device: { platform: "iOS", interfaceStyle: "Light" },
        products: [{ annual: { price: "$59.99", trialPeriodDays: 7 } }],
      },
    });
    expect(burst?.[2]).toEqual({
      event_name: "products",
      products: [{ product: "annual", productId: "pro_5999_year" }],
    });
    expect(burst?.[3]).toEqual({
      event_name: "template_substitutions_prefix",
      prefix: "freeTrial",
    });
    expect(burst?.[4]).toEqual({
      event_name: "paywall_open",
      paywall_id: "208540",
      paywall_identifier: "plus_upgrade",
    });
  });

  it("shows example prices for a slot the catalogue cannot price", () => {
    render(<SurfaceEditor source={source} surface={live} samples={{}} onBack={() => {}} />);
    const host = hostOf(preview());
    host.ping();
    const [burst] = host.sent();
    expect(burst?.[0]).toMatchObject({
      variables: { products: [{ annual: { price: "$89.99", trialPeriodText: "7-day" } }] },
    });
  });

  it("switches theme and locale by re-sending device variables, not by reloading", () => {
    render(
      <SurfaceEditor
        source={source}
        surface={{ ...live, locales: ["en", "de"] }}
        samples={{}}
        onBack={() => {}}
      />,
    );
    const frame = preview();
    const host = hostOf(frame);
    host.ping();

    const [, dark] = within(screen.getByRole("group", { name: "Theme" })).getAllByRole("button");
    if (!dark) throw new Error("no dark theme button");
    fireEvent.click(dark);
    fireEvent.change(screen.getByLabelText("Locale"), { target: { value: "de" } });

    expect(screen.getAllByTitle("plus-upgrade preview")).toHaveLength(1);
    const updates = host.sent().slice(1);
    expect(updates.map((events) => events.map((event) => event.event_name))).toEqual([
      ["template_variables"],
      ["template_variables"],
    ]);
    expect(updates[1]?.[0]).toMatchObject({
      variables: {
        device: { interfaceStyle: "Dark", deviceLocale: "de", deviceLanguageCode: "de" },
      },
    });
  });

  it("lists only the locales the host knows", () => {
    render(<SurfaceEditor source={source} surface={live} samples={{}} onBack={() => {}} />);
    expect(screen.queryByLabelText("Locale")).toBeNull();
  });

  it("flips trial eligibility through the prefix alone", () => {
    render(<SurfaceEditor source={source} surface={live} samples={{}} onBack={() => {}} />);
    const host = hostOf(preview());
    host.ping();

    const trial = screen.getByRole("switch", { name: "Introductory offer" });
    expect(trial.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(trial);

    expect(host.sent().at(-1)).toEqual([
      { event_name: "template_substitutions_prefix", prefix: "default" },
    ]);
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

  it("puts the host's own controls in the top bar and keeps standalone preview local", () => {
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
    expect(screen.queryByRole("button", { name: "Open preview" })).toBeNull();
  });
});
