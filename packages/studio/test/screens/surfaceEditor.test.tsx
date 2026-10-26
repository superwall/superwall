import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceEditor } from "../../src/screens/SurfaceEditor";
import type { StudioHandle } from "../../src/lib/commands";
import { StudioHostProvider } from "../../src/lib/studio-host";

const renderEditor = (element: React.ReactElement<React.ComponentProps<typeof SurfaceEditor>>) =>
  render(
    <StudioHostProvider mode="local" home={{ href: "/", navigate: () => {} }}>
      {element}
    </StudioHostProvider>,
  );
import { devServerActions } from "../../src/lib/actions";
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
  label: "v12 · Live",
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
    expect(screen.getByText("Plus Upgrade / v12 · Live · plus-upgrade")).toBeTruthy();
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
    expect(screen.queryByText("v12 · Live")).toBeNull();
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
      expect(image.getAttribute("alt")).toBe(`${shot.id} original`);
      fireEvent.error(image);
    }
    expect(screen.getByText(/screenshot is missing/)).toBeTruthy();
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
    actions: devServerActions,
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
    expect(parseFloat(screen.getByTestId("device-frame").style.borderRadius)).toBe(3);
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
          actions: devServerActions,
          previewUrl: () => "/preview",
        }}
        surface={local}
        samples={{}}
      />,
    );
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));

    expect(screen.getByRole("status").textContent).toContain(
      "Couldn’t read the pushed versions — not logged in",
    );
    expect(screen.queryByText(/live/i)).toBeNull();
  });
});

describe("SurfaceEditor promoting and rolling back", () => {
  const local: StudioSurface = {
    kind: "paywall",
    id: "plus-upgrade",
    routes: ["index"],
    locales: ["en"],
    products: {},
  };

  const versions = [
    { version: 13, url: "https://cdn.test/13.html", live: false },
    { version: 12, url: "https://cdn.test/12.html", live: true },
    { version: 11, url: "https://cdn.test/11.html", live: false },
  ];

  const devServer = (result: unknown) =>
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/__studio/status/")) {
        return { ok: true, json: async () => ({ paywallId: "208540", versions }) } as Response;
      }
      void init;
      const lines = [
        JSON.stringify({ step: "link", state: "done" }),
        JSON.stringify({ step: "promote", state: "done" }),
        JSON.stringify({ result }),
      ].join("\n");
      return { ok: true, body: new Response(lines).body, json: async () => result } as Response;
    });

  const actionBodies = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls
      .filter(([input]) => String(input).includes("/__studio/action"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

  const shippable: StudioSource = {
    title: "chatgpt",
    surfaces: [local],
    actions: devServerActions,
    previewUrl: () => "/preview/paywall/plus-upgrade?transport=editor",
  };

  it("promotes the latest push by default, sending no version so every platform takes its own", async () => {
    const fetchMock = devServer({ ok: true, version: 13, live: true });
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(<SurfaceEditor source={shippable} surface={local} samples={{}} />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Choose action" }));
    expect(screen.getByText("Make v13 live, replacing v12")).toBeDefined();
    fireEvent.click(screen.getByText("Promote"));
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await act(async () => {});

    expect(actionBodies(fetchMock)).toEqual([
      { action: "promote", kind: "paywall", id: "plus-upgrade" },
    ]);
  });

  it("rolls back to a picked older version, and sends exactly that version", async () => {
    const fetchMock = devServer({ ok: true, version: 11, live: true });
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(<SurfaceEditor source={shippable} surface={local} samples={{}} />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Version" }));
    fireEvent.click(screen.getByText("v11"));
    const button = screen.getByRole("button", { name: "Roll back" });
    fireEvent.click(button);
    await act(async () => {});

    expect(actionBodies(fetchMock)).toEqual([
      { action: "promote", version: 11, kind: "paywall", id: "plus-upgrade" },
    ]);
    expect(screen.getByText("Roll back complete")).toBeDefined();
  });

  it("forgets the pick when the surface changes", async () => {
    vi.stubGlobal("fetch", devServer({ ok: true, version: 11, live: true }));
    const other: StudioSurface = { ...local, id: "win-back" };
    const view = renderEditor(
      <SurfaceEditor
        source={{ ...shippable, surfaces: [local, other] }}
        surface={local}
        samples={{}}
      />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Version" }));
    fireEvent.click(screen.getByText("v11"));
    expect(screen.getByRole("button", { name: "Roll back" })).toBeDefined();

    view.rerender(
      <StudioHostProvider mode="local" home={{ href: "/", navigate: () => {} }}>
        <SurfaceEditor
          source={{ ...shippable, surfaces: [local, other] }}
          surface={other}
          samples={{}}
        />
      </StudioHostProvider>,
    );
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Promote" })).toBeDefined();
  });

  describe("hosted by the dashboard", () => {
    const olderSurface: StudioSurface = { ...live, label: "v11", version: 11 };
    const liveSurface: StudioSurface = { ...live, version: 12 };
    const newerSurface: StudioSurface = { ...pushed, version: 13 };

    const pick = vi.fn();
    const hosted = (run: ReturnType<typeof vi.fn>): StudioSource => ({
      ...source,
      surfaces: [newerSurface, liveSurface, olderSurface],
      actions: {
        offered: ["promote"],
        run,
        status: async () => ({ paywallId: "208540", versions }),
        pick,
      },
    });

    it("offers Roll back on a version older than the live one, and runs it with that version", async () => {
      const run = vi.fn(async () => ({ ok: true as const, version: 11, live: true }));
      renderEditor(<SurfaceEditor source={hosted(run)} surface={olderSurface} samples={{}} />);
      await act(async () => {});

      expect(screen.queryByRole("button", { name: "Choose action" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
      const picker = screen.getByRole("button", { name: "Version" });
      expect(picker.textContent).toBe("v11");
      fireEvent.click(picker);
      fireEvent.click(screen.getByText("v13"));
      expect(pick).toHaveBeenCalledWith(13);
      fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
      await act(async () => {});

      expect(run).toHaveBeenCalledWith(
        olderSurface,
        { action: "promote", version: 11 },
        expect.any(Function),
      );
    });

    it("offers Promote on a version newer than the live one", async () => {
      const run = vi.fn(async () => ({ ok: true as const, version: 13, live: true }));
      renderEditor(<SurfaceEditor source={hosted(run)} surface={newerSurface} samples={{}} />);
      await act(async () => {});

      fireEvent.click(screen.getByRole("button", { name: "Promote" }));
      await act(async () => {});
      expect(run).toHaveBeenCalledWith(
        newerSurface,
        { action: "promote", version: 13 },
        expect.any(Function),
      );
    });

    it("refuses to promote the version that is already live", async () => {
      const run = vi.fn();
      renderEditor(<SurfaceEditor source={hosted(run)} surface={liveSurface} samples={{}} />);
      await act(async () => {});

      const button = screen.getByRole("button", { name: "Promote" });
      expect(button.hasAttribute("disabled")).toBe(true);
      fireEvent.click(button);
      expect(run).not.toHaveBeenCalled();
    });

    it("shows the host's failure in the panel", async () => {
      const run = vi.fn(async () => ({ ok: false as const, error: "paywalls:write is missing" }));
      renderEditor(<SurfaceEditor source={hosted(run)} surface={olderSurface} samples={{}} />);
      await act(async () => {});

      fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
      await act(async () => {});
      expect(screen.getByText("Roll back failed")).toBeDefined();
      expect(screen.getByRole("alert").textContent).toBe("paywalls:write is missing");
    });
  });
});

describe("SurfaceEditor driven by its host", () => {
  const surfaceWithLocales: StudioSurface = { ...live, locales: ["en", "de-DE"] };

  const drive = async (
    handle: React.RefObject<StudioHandle | null>,
    commands: Parameters<StudioHandle["run"]>[0],
  ) => {
    let result: Awaited<ReturnType<StudioHandle["run"]>> | undefined;
    let running: ReturnType<StudioHandle["run"]> | undefined;
    // Two acts: the run resolves after the commit its commands cause, which an
    // async act awaiting it would hold back until it returned.
    act(() => {
      running = handle.current?.run(commands);
    });
    await act(async () => {
      result = await running;
    });
    if (!result) throw new Error("the editor did not answer");
    return result;
  };

  it("applies commands to the controls a person uses, and reports what is on stage", async () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(
      <SurfaceEditor ref={handle} source={source} surface={surfaceWithLocales} samples={{}} />,
    );
    const host = hostOf(preview());
    host.ping();

    const result = await drive(handle, [
      { type: "device", device: "iPhone 17 Pro Max" },
      { type: "orientation", orientation: "landscape" },
      { type: "theme", theme: "dark" },
      { type: "locale", locale: "de_de" },
      { type: "introductoryOffer", eligible: true },
      { type: "variable", path: "user.name", value: "Ada" },
      { type: "variable", path: "products.annual.price", value: "$1" },
      { type: "variablesPanel", open: true },
      { type: "zoom", to: 50 },
    ]);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.state).toMatchObject({
      surface: { id: "plus-upgrade", label: "v12 · Live" },
      device: { id: "iphone-17-pro-max", name: "iPhone 17 Pro Max", width: 956, height: 440 },
      orientation: "landscape",
      theme: "dark",
      locale: "de-DE",
      locales: ["en", "de-DE"],
      introductoryOffer: { eligible: true, overridden: true },
      zoom: { percent: 50, fitted: false },
      variables: { user: { name: "Ada" }, products: { annual: { price: "$1" } } },
      variablesPanel: true,
      compare: null,
    });
    expect((screen.getByLabelText("Device") as HTMLSelectElement).value).toBe("iphone-17-pro-max");
    expect(screen.getByRole("button", { name: "Rotate device" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("switch", { name: "Introductory offer" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: /Variables/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(host.sent().at(-1)?.[0]).toMatchObject({
      variables: {
        device: { interfaceStyle: "Dark", deviceLocale: "de-DE" },
        user: { name: "Ada" },
      },
    });
    expect(handle.current?.state().theme).toBe("dark");
  });

  it("says which commands it could not apply, and still applies the rest", async () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(
      <SurfaceEditor
        ref={handle}
        source={source}
        surface={{ ...live, version: 12 }}
        samples={{}}
      />,
    );

    const result = await drive(handle, [
      { type: "device", device: "Nokia 3310" },
      { type: "locale", locale: "fr" },
      { type: "variable", path: "experiment.id", value: 1 },
      { type: "version", version: 4 },
      { type: "compare", with: "nothing" },
      { type: "theme", theme: "dark" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { index: 0, type: "device", error: 'no device "Nokia 3310"; see state.devices' },
      { index: 1, type: "locale", error: "this paywall has one language only" },
      {
        index: 2,
        type: "variable",
        error:
          "experiment.id is not user.<key>, device.<key>, params.<key> or products.<reference>.<key>",
      },
      { index: 3, type: "version", error: "this studio cannot switch versions" },
      {
        index: 4,
        type: "compare",
        error: 'nothing to compare called "nothing"; see state.compareOptions',
      },
    ]);
    expect(result.state.theme).toBe("dark");
  });

  it("names the locales it has when asked for another", async () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(
      <SurfaceEditor ref={handle} source={source} surface={surfaceWithLocales} samples={{}} />,
    );
    const result = await drive(handle, [
      { type: "locale", locale: "fr" },
      { type: "locale", locale: null },
    ]);
    expect(result.errors).toEqual([
      { index: 0, type: "locale", error: "this paywall has no fr locale; it has en, de-DE" },
    ]);
    expect(result.state.locale).toBeNull();
  });

  it("zooms, resizes, compares and reloads like the toolbar", async () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(<SurfaceEditor ref={handle} source={source} surface={live} samples={{}} />);

    const zoomed = await drive(handle, [{ type: "zoom", to: "in" }]);
    expect(zoomed.state.zoom.fitted).toBe(false);
    await drive(handle, [{ type: "zoom", to: "out" }]);
    await drive(handle, [{ type: "zoom", to: "actual" }]);
    const fitted = await drive(handle, [{ type: "zoom", to: "fit" }]);
    expect(fitted.state.zoom.fitted).toBe(true);

    const sized = await drive(handle, [
      { type: "size", width: 900 },
      { type: "size", height: 5000 },
    ]);
    expect(sized.state.device).toEqual({
      id: "responsive",
      name: "Responsive",
      width: 900,
      height: 3000,
    });
    const back = await drive(handle, [
      { type: "device", device: "responsive" },
      { type: "orientation", orientation: "portrait" },
    ]);
    expect(back.state.device.id).toBe("responsive");

    const compared = await drive(handle, [{ type: "compare", with: "V13" }]);
    expect(compared.state.compare).toBe("surface:paywall/plus-upgrade");
    expect(compared.state.compareOptions).toEqual([
      { key: "surface:paywall/plus-upgrade", label: "v13" },
    ]);
    expect(screen.getByTitle("v13 preview")).toBeTruthy();
    const ended = await drive(handle, [{ type: "compare", with: null }, { type: "reload" }]);
    expect(ended.state.compare).toBeNull();
    expect(screen.queryByTitle("v13 preview")).toBeNull();
  });

  it("resets the variables but keeps the offer switch, and clears the switch alone", async () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(<SurfaceEditor ref={handle} source={source} surface={live} samples={{}} />);
    await drive(handle, [
      { type: "variable", path: "params.source", value: "push" },
      { type: "introductoryOffer", eligible: false },
    ]);
    const reset = await drive(handle, [{ type: "resetVariables" }]);
    expect(reset.state.variables).toEqual({});
    expect(reset.state.introductoryOffer).toEqual({ eligible: false, overridden: true });
    const cleared = await drive(handle, [
      { type: "introductoryOffer", eligible: null },
      { type: "resetVariables" },
    ]);
    expect(cleared.state.introductoryOffer.overridden).toBe(false);
  });

  it("switches pushed versions through the host's picker, and compares the original", async () => {
    const pick = vi.fn();
    const rebuilt: StudioSurface = {
      ...live,
      version: 12,
      origin: { paywallId: "1", url: "https://editor.test/1" },
    };
    const hosted: StudioSource = {
      ...source,
      surfaces: [rebuilt],
      actions: {
        offered: ["promote"],
        run: vi.fn(),
        status: async () => ({
          paywallId: "208540",
          versions: [
            { version: 13, url: "https://cdn.test/13.html", live: false },
            { version: 12, url: "https://cdn.test/12.html", live: true },
          ],
        }),
        pick,
      },
    };
    const handle = React.createRef<StudioHandle>();
    renderEditor(<SurfaceEditor ref={handle} source={hosted} surface={rebuilt} samples={{}} />);
    await act(async () => {});

    const result = await drive(handle, [
      { type: "version", version: 13 },
      { type: "version", version: 9 },
      { type: "compare", with: "Original" },
    ]);
    expect(pick).toHaveBeenCalledWith(13);
    expect(result.errors).toEqual([
      { index: 1, type: "version", error: "there is no v9; see state.versions" },
    ]);
    expect(result.state.versions).toEqual([
      { version: 13, live: false },
      { version: 12, live: true },
    ]);
    expect(result.state.compare).toBe("origin");
    expect(result.state.surface).toEqual({ id: "plus-upgrade", label: "v12 · Live", version: 12 });

    const version = await drive(handle, [{ type: "compare", with: "version:13" }]);
    expect(version.state.compare).toBe("version:13");
  });

  it("reports the zoom it last heard before the canvas mounts a handle", () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(<SurfaceEditor ref={handle} source={source} surface={live} samples={{}} />);
    expect(handle.current?.state().zoom).toEqual({ percent: 100, fitted: true });
  });

  it("lays the host's panel at the start of the stage row, open or closed", () => {
    const view = renderEditor(
      <SurfaceEditor
        source={source}
        surface={live}
        samples={{}}
        panel={{ open: false, label: "Chat", content: <div data-testid="slot" /> }}
      />,
    );
    const panel = screen.getByTestId("host-panel");
    expect(panel.getAttribute("aria-label")).toBe("Chat");
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(panel.className).toContain("w-0");
    // The panel runs the full height; the stage and its toolbar sit beside it.
    const column = screen.getByTestId("stage-column");
    expect(panel.nextElementSibling).toBe(column);
    expect(column.contains(screen.getByTestId("canvas"))).toBe(true);
    expect(column.contains(screen.getByRole("group", { name: "Zoom" }))).toBe(true);
    expect(panel.contains(screen.getByRole("group", { name: "Zoom" }))).toBe(false);
    expect(screen.queryByRole("separator", { name: "Resize chat" })).toBeNull();
    expect(within(panel).getByTestId("slot")).toBeTruthy();

    view.rerender(
      <StudioHostProvider mode="local" home={{ href: "/", navigate: () => {} }}>
        <SurfaceEditor
          source={source}
          surface={live}
          samples={{}}
          panel={{ open: true, label: "Chat", content: <div data-testid="slot" /> }}
        />
      </StudioHostProvider>,
    );
    expect(screen.getByTestId("host-panel").getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByTestId("host-panel").className).toContain("w-(--sw-host-panel)");
    expect(screen.getByTestId("stage-column").previousElementSibling).toBe(
      screen.getByRole("separator", { name: "Resize chat" }).parentElement,
    );
  });

  it("lets the host own the panel's width, and reserves the Variables panel beside the stage", () => {
    const onWidthChange = vi.fn();
    renderEditor(
      <SurfaceEditor
        source={source}
        surface={live}
        samples={{}}
        panel={{ open: true, label: "Chat", content: null, width: 500, onWidthChange }}
      />,
    );
    const panel = screen.getByTestId("host-panel");
    expect(panel.style.getPropertyValue("--sw-host-panel")).toContain("500px");
    expect(panel.style.getPropertyValue("--sw-host-panel")).toContain("100cqw - 400px");
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));
    expect(panel.style.getPropertyValue("--sw-host-panel")).toContain("100cqw - 720px");
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize chat" }), {
      key: "ArrowRight",
    });
    expect(onWidthChange).toHaveBeenCalledWith(516);
    expect(window.localStorage.getItem("sw-studio-panel-width")).toBeNull();
  });
});

describe("a surface the account does not have yet", () => {
  const unsavedSource = (saving?: "preview" | "promote" | "screenshot") => {
    const save = vi.fn();
    return { save, source: { ...source, unsaved: { saving, save } } satisfies StudioSource };
  };

  it("saves it first for Promote, Preview and the screenshot", async () => {
    const { save, source: unsaved } = unsavedSource();
    renderEditor(<SurfaceEditor source={unsaved} surface={live} samples={{}} />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Download screenshot" }));
    expect(save.mock.calls).toEqual([["promote"], ["preview"], ["screenshot"]]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the action a save runs for as saving, and holds the others", async () => {
    const { source: unsaved } = unsavedSource("promote");
    renderEditor(<SurfaceEditor source={unsaved} surface={live} samples={{}} />);
    await act(async () => {});

    const promote = screen.getByRole("button", { name: "Saving…" });
    expect(promote.hasAttribute("disabled")).toBe(true);
    expect(promote.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Preview" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Download screenshot" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("names Preview and the screenshot as saving when a save runs for them", async () => {
    const preview = unsavedSource("preview");
    const { unmount } = renderEditor(
      <SurfaceEditor source={preview.source} surface={live} samples={{}} />,
    );
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    unmount();

    const screenshot = unsavedSource("screenshot");
    renderEditor(<SurfaceEditor source={screenshot.source} surface={live} samples={{}} />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
  });
});

describe("finishing an action a save was made for", () => {
  const savedVersions = [{ version: 1, url: "https://cdn.test/v1.html", live: false }];
  const saved: StudioSurface = { ...live, label: "v1", version: 1 };

  it("promotes the saved version once its versions are known, and says so once", async () => {
    const run = vi.fn(async () => ({ ok: true as const, version: 1, live: true }));
    const onResumed = vi.fn();
    const hosted: StudioSource = {
      ...source,
      surfaces: [saved],
      actions: {
        offered: ["promote"],
        run,
        status: async () => ({ paywallId: "208540", versions: savedVersions }),
      },
    };
    const { rerender } = renderEditor(
      <SurfaceEditor
        source={hosted}
        surface={saved}
        samples={{}}
        resume="promote"
        onResumed={onResumed}
      />,
    );
    await act(async () => {});

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      saved,
      { action: "promote", version: 1 },
      expect.any(Function),
    );
    expect(onResumed).toHaveBeenCalledTimes(1);

    rerender(
      <StudioHostProvider mode="local" home={{ href: "/", navigate: () => {} }}>
        <SurfaceEditor source={hosted} surface={saved} samples={{}} onResumed={onResumed} />
      </StudioHostProvider>,
    );
    await act(async () => {});
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for a shipping seam before promoting", async () => {
    const onResumed = vi.fn();
    renderEditor(
      <SurfaceEditor
        source={source}
        surface={saved}
        samples={{}}
        resume="promote"
        onResumed={onResumed}
      />,
    );
    await act(async () => {});
    expect(onResumed).not.toHaveBeenCalled();
  });

  it("opens Preview on a device for a save made to preview", async () => {
    const onResumed = vi.fn();
    renderEditor(
      <SurfaceEditor
        source={source}
        surface={saved}
        samples={{}}
        resume="preview"
        onResumed={onResumed}
      />,
    );
    await act(async () => {});
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(onResumed).toHaveBeenCalledTimes(1);
  });
});
