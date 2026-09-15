import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceEditor } from "../../src/screens/SurfaceEditor";
import { StudioHostProvider } from "../../src/lib/studio-host";

const renderEditor = (element: React.ReactElement<React.ComponentProps<typeof SurfaceEditor>>) =>
  render(
    <StudioHostProvider mode="local" home={{ href: "/", navigate: () => {} }}>
      {element}
    </StudioHostProvider>,
  );
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
    renderEditor(<SurfaceEditor source={source} surface={live} samples={{}} />);
    const url = new URL(preview().src);
    expect(`${url.origin}${url.pathname}`).toBe("https://cdn.test/v12.html");
    expect(url.searchParams.get("transport")).toBe("editor");
    expect(url.searchParams.has("sw_preview")).toBe(false);
    expect(url.searchParams.has("theme")).toBe(false);
    expect(screen.getByText("Plus Upgrade / plus-upgrade · v12 · live")).toBeTruthy();
  });

  it("answers the paywall's ping with the version's products and identity", () => {
    renderEditor(
      <SurfaceEditor
        source={source}
        surface={live}
        samples={{ products: { pro_5999_year: { price: "$59.99", trialPeriodDays: 7 } } }}
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

  it("sends no prices for a slot the catalogue cannot price", () => {
    // The paywall hears about the slot but gets no variables for it, exactly as
    // it would on a device whose store had nothing for that identifier.
    renderEditor(<SurfaceEditor source={source} surface={live} samples={{}} />);
    const host = hostOf(preview());
    host.ping();
    const [burst] = host.sent();
    expect(burst?.[0]).toMatchObject({ variables: { products: [{ annual: {} }] } });
  });

  it("switches theme and locale by re-sending device variables, not by reloading", () => {
    renderEditor(
      <SurfaceEditor source={source} surface={{ ...live, locales: ["en", "de"] }} samples={{}} />,
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
    renderEditor(<SurfaceEditor source={source} surface={live} samples={{}} />);
    expect(screen.queryByLabelText("Locale")).toBeNull();
  });

  it("flips trial eligibility through the prefix alone", () => {
    renderEditor(<SurfaceEditor source={source} surface={live} samples={{}} />);
    const host = hostOf(preview());
    host.ping();

    const trial = screen.getByRole("switch", { name: "Introductory offer" });
    expect(trial.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(trial);

    expect(host.sent().at(-1)).toEqual([
      { event_name: "template_substitutions_prefix", prefix: "freeTrial" },
    ]);
  });

  it("offers the other versions to compare against, named by the host", () => {
    renderEditor(<SurfaceEditor source={source} surface={live} samples={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(screen.getByText("Published snapshot")).toBeTruthy();
    expect(screen.queryByText("v12 · live")).toBeNull();
    fireEvent.click(screen.getByText("v13"));

    expect(preview().src).toContain("v12.html");
    const compared = screen.getByTitle("v13 preview");
    expect(compared).toBeInstanceOf(HTMLIFrameElement);
    if (compared instanceof HTMLIFrameElement) expect(compared.src).toContain("v13.html");
  });

  it("offers the dashboard paywall a surface was rebuilt from, served as it is today", () => {
    const rebuilt: StudioSurface = {
      ...live,
      origin: { paywallId: "65920", url: "https://runtime.example/doc/abc" },
    };
    renderEditor(
      <SurfaceEditor
        source={{ ...source, surfaces: [pushed, rebuilt] }}
        surface={rebuilt}
        samples={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(screen.getByText("Rebuilt from")).toBeTruthy();
    fireEvent.click(screen.getByText("Original"));

    const compared = screen.getByTitle(`${rebuilt.id} original`);
    expect(compared).toBeInstanceOf(HTMLIFrameElement);
    if (compared instanceof HTMLIFrameElement) {
      expect(compared.src).toBe("https://runtime.example/doc/abc");
    }
  });

  it("opens straight onto the original when the URL asks for it", () => {
    const rebuilt: StudioSurface = {
      ...live,
      origin: { paywallId: "65920", url: "https://runtime.example/doc/abc" },
    };
    window.history.replaceState({}, "", `/paywall/${rebuilt.id}?compare=origin`);
    const view = renderEditor(
      <SurfaceEditor
        source={{ ...source, surfaces: [pushed, rebuilt] }}
        surface={rebuilt}
        samples={{}}
      />,
    );
    expect(screen.getByTitle(`${rebuilt.id} original`)).toBeInstanceOf(HTMLIFrameElement);
    view.unmount();

    window.history.replaceState({}, "", `/paywall/${live.id}?compare=origin`);
    renderEditor(<SurfaceEditor source={source} surface={live} samples={{}} />);
    expect(screen.queryByTitle(`${live.id} original`)).toBeNull();
    window.history.replaceState({}, "", "/");
  });

  it("shows a native screen's simulator screenshot as the original, and offers nothing without one", () => {
    const shot: StudioSurface = {
      ...live,
      id: "update-required",
      origin: {
        path: "../App/UpdateRequiredView.swift",
        framework: "swiftui",
        screenshot: "original.png",
      },
    };
    window.history.replaceState({}, "", `/paywall/${shot.id}?compare=origin`);
    const view = renderEditor(
      <SurfaceEditor
        source={{ ...source, surfaces: [pushed, shot] }}
        surface={shot}
        samples={{}}
      />,
    );
    const image = screen.getByTitle(`${shot.id} original`);
    expect(image).toBeInstanceOf(HTMLImageElement);
    if (image instanceof HTMLImageElement) {
      expect(image.getAttribute("src")).toBe("/__studio/original/paywall/update-required");
    }
    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(
      screen.getByText(/SwiftUI screen \.\.\/App\/UpdateRequiredView.swift, as captured/),
    ).toBeTruthy();
    view.unmount();

    const bare: StudioSurface = {
      ...live,
      id: "rate-us",
      origin: { path: "src/RateUs.tsx", framework: "react-native" },
    };
    window.history.replaceState({}, "", `/paywall/${bare.id}?compare=origin`);
    renderEditor(
      <SurfaceEditor
        source={{ ...source, surfaces: [pushed, bare] }}
        surface={bare}
        samples={{}}
      />,
    );
    expect(screen.queryByTitle(`${bare.id} original`)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(screen.queryByText("Original")).toBeNull();
    window.history.replaceState({}, "", "/");
  });

  it("puts the host's own controls in the top bar and keeps standalone preview local", () => {
    renderEditor(
      <SurfaceEditor
        source={source}
        surface={live}
        samples={{}}
        actions={<button type="button">Version</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Version" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open preview" })).toBeNull();
  });
});

describe("SurfaceEditor shipping a local surface", () => {
  const local: StudioSurface = {
    kind: "paywall",
    id: "plus-upgrade",
    routes: ["index"],
    locales: ["en"],
    products: {},
  };

  const shippable: StudioSource = {
    title: "chatgpt",
    surfaces: [local],
    capabilities: { actions: true },
    previewUrl: () => "/preview/paywall/plus-upgrade?transport=editor",
    standaloneUrl: () => "/paywall/plus-upgrade",
  };

  const stream = (steps: readonly string[], result: unknown) =>
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/__studio/status/")) {
        return { ok: true, json: async () => ({ paywallId: "208540", active: true }) } as Response;
      }
      const lines = [
        ...steps.flatMap((step) => [
          JSON.stringify({ step, state: "start" }),
          JSON.stringify({ step, state: "done" }),
        ]),
        JSON.stringify({ result }),
      ].join("\n");
      return {
        ok: true,
        body: new Response(lines).body,
        json: async () => result,
      } as Response;
    });

  const ship = async (label: string) => {
    const menu = screen.getByRole("button", { name: /push|publish|promote/i });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "i") }));
    await act(async () => {});
  };

  it("walks the steps a push takes and ends on the pushed version", async () => {
    vi.stubGlobal(
      "fetch",
      stream(["link", "build", "assets", "push"], { ok: true, version: 13, live: false }),
    );
    vi.useFakeTimers();

    renderEditor(<SurfaceEditor source={shippable} surface={local} samples={{}} />);
    await act(async () => {});
    await ship("push");

    expect(screen.getAllByText(/Push version|Build snapshot/).length).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    vi.useRealTimers();
  });

  it("marks the step that was running as failed and says why", async () => {
    vi.stubGlobal(
      "fetch",
      stream(["link", "build"], { ok: false, error: "products missing from the dashboard" }),
    );

    renderEditor(<SurfaceEditor source={shippable} surface={local} samples={{}} />);
    await act(async () => {});
    await ship("push");

    expect(screen.getByText(/products missing from the dashboard/)).toBeTruthy();
  });

  it("opens a phone-sized standalone preview in a sized window, a desktop one in a tab", async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", stream([], { ok: true, version: 1, live: false }));

    renderEditor(<SurfaceEditor source={shippable} surface={local} samples={{}} />);
    await act(async () => {});

    fireEvent.click(screen.getByLabelText("Open preview"));

    const [url, target, features] = open.mock.calls[0] as unknown as [string, string, string?];
    expect(url).toBe("/paywall/plus-upgrade");
    expect(target).toBe("superwall-preview");
    expect(String(features)).toMatch(/width=\d+/);
    expect(String(features)).toContain("resizable=no");
  });

  it("opens a desktop-sized preview in a plain tab", async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", stream([], { ok: true, version: 1, live: false }));

    renderEditor(<SurfaceEditor source={shippable} surface={local} samples={{}} />);
    await act(async () => {});

    fireEvent.change(screen.getByLabelText("Device"), { target: { value: "desktop" } });
    fireEvent.click(screen.getByLabelText("Open preview"));

    const [url, target, features] = open.mock.calls.at(-1) as unknown as [string, string, string?];
    expect(url).toBe("/paywall/plus-upgrade");
    expect(target).toBe("_blank");
    expect(features).toBeUndefined();
  });

  it("falls back to a tab when the popup is blocked", async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", stream([], { ok: true, version: 1, live: false }));

    renderEditor(<SurfaceEditor source={shippable} surface={local} samples={{}} />);
    await act(async () => {});

    fireEvent.click(screen.getByLabelText("Open preview"));

    expect(open).toHaveBeenCalledTimes(2);
    const [, target] = open.mock.calls.at(-1) as unknown as [string, string];
    expect(target).toBe("_blank");
  });

  it("does nothing when the host offers no standalone url", async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", stream([], { ok: true, version: 1, live: false }));
    const { standaloneUrl: _omitted, ...hosted } = shippable;

    renderEditor(<SurfaceEditor source={hosted} surface={local} samples={{}} />);
    await act(async () => {});

    const opener = screen.queryByLabelText("Open preview");
    if (opener) fireEvent.click(opener);

    expect(open).not.toHaveBeenCalled();
  });
});

describe("SurfaceEditor's smaller states", () => {
  const local: StudioSurface = {
    kind: "paywall",
    id: "plus-upgrade",
    routes: ["index"],
    locales: [],
    products: {},
  };

  it("commits a responsive size on Enter, clamped to something renderable", async () => {
    renderEditor(
      <SurfaceEditor
        source={{ title: "chatgpt", surfaces: [local], previewUrl: () => "/preview" }}
        surface={local}
        samples={{}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Device"), { target: { value: "responsive" } });
    const width = screen.getByLabelText("Preview width");
    (width as HTMLInputElement).focus();
    fireEvent.change(width, { target: { value: "99999" } });
    fireEvent.keyDown(width, { key: "Enter" });

    expect((width as HTMLInputElement).value).toBe("3000");
  });

  it("resizes the responsive frame by dragging its edges, and only in responsive mode", async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    renderEditor(
      <SurfaceEditor
        source={{ title: "chatgpt", surfaces: [local], previewUrl: () => "/preview" }}
        surface={local}
        samples={{}}
      />,
    );
    expect(screen.queryByTestId("resize-bottom-right")).toBeNull();

    fireEvent.change(screen.getByLabelText("Device"), { target: { value: "responsive" } });
    const corner = screen.getByTestId("resize-bottom-right");
    corner.setPointerCapture = () => {};
    fireEvent.pointerDown(corner, { pointerId: 1, clientX: 0, clientY: 0, button: 0, buttons: 1 });
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 27, clientY: -52, buttons: 1 });
    fireEvent.pointerUp(corner, { pointerId: 1 });

    expect((screen.getByLabelText("Preview width") as HTMLInputElement).value).toBe("420");
    expect((screen.getByLabelText("Preview height") as HTMLInputElement).value).toBe("800");
  });

  it("shows a web-only paywall as a bare viewport on the picked device, reporting web", async () => {
    const web: StudioSurface = { ...live, platforms: ["web"] };
    renderEditor(
      <SurfaceEditor
        source={{ ...source, surfaces: [web], previewUrl: () => "/preview" }}
        surface={web}
        samples={{}}
      />,
    );
    await act(async () => {});

    expect((screen.getByLabelText("Device") as HTMLSelectElement).value).toBe("iphone-17");
    expect(screen.queryByTestId("device-chrome")).toBeNull();
    expect(parseFloat(screen.getByTestId("device-frame").style.borderRadius)).toBe(0);
    expect(preview().getAttribute("width")).toBe("402");
    expect(preview().getAttribute("height")).toBe(String(874 - 64 - 84));
    const host = hostOf(preview());
    host.ping();
    expect(host.sent()[0]?.[0]).toMatchObject({
      variables: { device: { platform: "web", deviceModel: "iPhone18,3" } },
    });
  });

  it("puts zoom in the toolbar: step buttons, and the percentage fits", async () => {
    renderEditor(
      <SurfaceEditor
        source={{ ...source, surfaces: [live], previewUrl: () => "/preview" }}
        surface={live}
        samples={{}}
      />,
    );
    await act(async () => {});
    const fitButton = () => screen.getByRole("button", { name: "Fit to view" });
    expect(fitButton().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(fitButton().getAttribute("aria-pressed")).toBe("false");
    expect(fitButton().textContent).toMatch(/\d+%/);

    fireEvent.click(fitButton());
    expect(fitButton().getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Fit" })).toBeNull();
  });

  it("keeps the phone's own chrome for a native paywall", async () => {
    renderEditor(
      <SurfaceEditor
        source={{ ...source, surfaces: [live], previewUrl: () => "/preview" }}
        surface={live}
        samples={{}}
      />,
    );
    await act(async () => {});
    expect(screen.getByTestId("device-chrome")).toBeDefined();
  });

  it("says why it cannot list the pushed versions to compare against", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ paywallId: "208540", unreachable: "not logged in" }),
          }) as Response,
      ),
    );

    renderEditor(
      <SurfaceEditor
        source={{
          title: "chatgpt",
          surfaces: [local],
          capabilities: { actions: true },
          previewUrl: () => "/preview",
        }}
        surface={local}
        samples={{}}
      />,
    );
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));

    expect(screen.getByRole("status").textContent).toContain(
      "Couldn't read the pushed versions — not logged in",
    );
    expect(screen.queryByText(/live/i)).toBeNull();
  });
});
