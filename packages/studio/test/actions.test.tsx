import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction } from "../src/lib/actions";
import { buildPreviewPath, withOverrides } from "../src/lib/preview";
import { StudioApp } from "../src/StudioApp";
import type { StudioSource } from "../src/lib/types";

const source: StudioSource = {
  title: "chatgpt",
  surfaces: [
    {
      kind: "paywall",
      id: "plus-upgrade",
      pageRoutes: ["/"],
      locales: ["en"],
      paywallId: "208540",
    },
  ],
  diagnostics: [],
  previewUrl: buildPreviewPath,
  capabilities: { actions: true },
};

const jsonResponse = (value: unknown) =>
  ({ ok: true, json: async () => value }) as unknown as Response;

const mockFetch = (routes: { status?: unknown; action?: unknown }): ReturnType<typeof vi.fn> => {
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/__studio/status/")) return jsonResponse(routes.status ?? {});
    if (url.includes("/__studio/action")) return jsonResponse(routes.action ?? { ok: true });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", impl);
  return impl;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studio actions", () => {
  it("ships with the selected action and reports the result", async () => {
    const fetchMock = mockFetch({
      status: { paywallId: "208540", liveUrl: "https://runtime.test/v5.html" },
      action: { ok: true, version: 6, live: false },
    });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    // the progress panel is the confirmation — no separate header label
    await waitFor(() => expect(screen.getByText("Push complete")).toBeDefined());
    expect(screen.queryByText(/v6 pushed/)).toBeNull();

    const call = fetchMock.mock.calls.find(([input]) => String(input).includes("/__studio/action"));
    const init = (call?.[1] ?? {}) as RequestInit;
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init.body))).toEqual({
      action: "push",
      kind: "paywall",
      id: "plus-upgrade",
    });
  });

  it("switches the default action from the menu and surfaces errors", async () => {
    mockFetch({ action: { ok: false, error: "Run `superwall login` first." } });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose action" }));
    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(screen.getByText("Run `superwall login` first.")).toBeDefined());
    // the menu remembers the chosen action as the new default
    expect(screen.getByRole("button", { name: "Publish" })).toBeDefined();
  });

  it("compare picks the live version from its menu and splits the stage", async () => {
    mockFetch({ status: { paywallId: "208540", liveUrl: "https://runtime.test/v5.html" } });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Compare/ })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    fireEvent.click(screen.getByText("Live version"));

    expect(screen.getByText("Live")).toBeDefined();
    expect(screen.getByText("Local")).toBeDefined();
    await waitFor(() => {
      const live = screen.getAllByTitle("plus-upgrade live").at(-1);
      expect(live?.getAttribute("src")).toContain("https://runtime.test/v5.html");
    });

    // Off returns to the single preview
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    fireEvent.click(screen.getByText("Off"));
    expect(screen.queryByText("Local")).toBeNull();
  });

  it("compare against another local paywall needs no platform at all", () => {
    mockFetch({});
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    const twoSurfaces: StudioSource = {
      ...source,
      capabilities: { actions: false },
      surfaces: [
        ...source.surfaces,
        { kind: "paywall", id: "win-back", pageRoutes: ["/"], locales: ["en"] },
      ],
    };
    render(<StudioApp source={twoSurfaces} />);

    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    // no live option without a platform host — only the other local paywall
    expect(screen.queryByText("Live version")).toBeNull();
    fireEvent.click(screen.getByText("paywall/win-back"));

    expect(screen.getByText("Local")).toBeDefined();
    const pane = screen.getAllByTitle("win-back preview").at(-1);
    expect(pane?.getAttribute("src")).toContain("/preview/paywall/win-back");
  });

  it("compare without anything live shows the placeholder", async () => {
    mockFetch({ status: {} });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    fireEvent.click(screen.getByText("Live version"));
    expect(screen.getByText(/Nothing live yet/)).toBeDefined();
  });

  it("hides ship and compare entirely when nothing can be compared", () => {
    mockFetch({});
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={{ ...source, capabilities: { actions: false } }} />);

    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Compare/ })).toBeNull();
  });
});

describe("home cards", () => {
  it("shows the dashboard trio: name, Active, published-ago — never a page count", async () => {
    mockFetch({
      status: {
        paywallId: "208540",
        liveUrl: "https://r.test/a.html",
        active: true,
        updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      },
    });
    window.history.replaceState({}, "", "/");
    render(<StudioApp source={source} />);

    expect(screen.getByText("plus-upgrade")).toBeDefined();
    await waitFor(() => expect(screen.getByText("Active")).toBeDefined());
    expect(screen.getByText(/Edited 2 hours ago/)).toBeDefined();
    expect(screen.queryByText(/page/)).toBeNull();
  });

  it("shows Inactive for a bound paywall in no campaign", async () => {
    mockFetch({ status: { paywallId: "208540", active: false } });
    window.history.replaceState({}, "", "/");
    render(<StudioApp source={source} />);

    await waitFor(() => expect(screen.getByText("Inactive")).toBeDefined());
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.getByText("Not published")).toBeDefined();
  });
});

describe("withOverrides", () => {
  it("appends the override channel to snapshot URLs", () => {
    expect(withOverrides("https://r.test/a.html", { theme: "dark" })).toBe(
      "https://r.test/a.html?theme=dark",
    );
    expect(withOverrides("https://r.test/a.html?x=1", { variables: { plan: "go" } })).toContain(
      "&sw_vars=",
    );
    expect(withOverrides("https://r.test/a.html", {})).toBe("https://r.test/a.html");
  });
});

describe("runAction streaming", () => {
  it("reports each pipeline step as the dev server streams it", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('{"step":"build","state":"start"}\n{"step":"build","state":"done"}\n'),
        );
        controller.enqueue(encoder.encode('{"step":"push","state":"start"}\n'));
        controller.enqueue(
          encoder.encode(
            '{"step":"push","state":"done"}\n{"result":{"ok":true,"version":7,"live":false}}\n',
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, body }) as unknown as Response),
    );

    const steps: string[] = [];
    const result = await runAction(
      { kind: "paywall", id: "plus-upgrade", pageRoutes: [], locales: [] },
      "push",
      (step, state) => steps.push(`${step}:${state}`),
    );

    expect(steps).toEqual(["build:start", "build:done", "push:start", "push:done"]);
    expect(result).toEqual({ ok: true, version: 7, live: false });
  });
});
