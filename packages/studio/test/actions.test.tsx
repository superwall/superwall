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
      routes: ["/"],
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

  it("lists the source push between the version and the promote", async () => {
    mockFetch({ action: { ok: true, version: 6, live: true } });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose action" }));
    fireEvent.click(screen.getByText("Publish"));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(screen.getByText("Publish complete")).toBeDefined());
    const list = screen.getByText("Push source").closest("ul");
    expect([...(list?.querySelectorAll("li") ?? [])].map((item) => item.textContent)).toEqual([
      "01Find paywall",
      "02Build snapshot",
      "03Sync assets",
      "04Push version",
      "05Push source",
      "06Promote to live",
    ]);
  });

  it("switches the default action from the menu and surfaces errors", async () => {
    const fetchMock = mockFetch({ action: { ok: false, error: "Run `superwall login` first." } });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose action" }));
    fireEvent.click(screen.getByText("Publish"));
    expect(screen.getByRole("button", { name: "Publish" })).toBeDefined();
    const actionCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes("/__studio/action"));
    expect(actionCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByText("Run `superwall login` first.")).toBeDefined());
    expect(actionCalls()).toHaveLength(1);
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
        { kind: "paywall", id: "win-back", routes: ["/"], locales: ["en"] },
      ],
    };
    render(<StudioApp source={twoSurfaces} />);

    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(screen.queryByText("Live version")).toBeNull();
    fireEvent.click(screen.getByText("paywall/win-back"));

    expect(screen.getByText("Local")).toBeDefined();
    const pane = screen.getAllByTitle("paywall/win-back preview").at(-1);
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

  it("the placeholder is exactly the size of the device frame beside it", async () => {
    mockFetch({ status: {} });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    fireEvent.click(screen.getByText("Live version"));

    const frame = screen.getByTestId("device-frame");
    const placeholder = screen.getByTestId("device-placeholder");

    expect(placeholder.style.width).toBe(frame.style.width);
    expect(placeholder.style.height).toBe(frame.style.height);
    expect(placeholder.style.width).not.toBe("");
  });

  it("the placeholder follows the device frame when the hardware changes", async () => {
    mockFetch({ status: {} });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    fireEvent.click(screen.getByText("Live version"));

    const before = screen.getByTestId("device-frame").style.width;
    fireEvent.change(screen.getByLabelText("Device"), { target: { value: "ipad-pro-11" } });

    const frame = screen.getByTestId("device-frame");
    const placeholder = screen.getByTestId("device-placeholder");
    expect(frame.style.width).not.toBe(before);
    expect(placeholder.style.width).toBe(frame.style.width);
    expect(placeholder.style.height).toBe(frame.style.height);
  });

  it("centers the placeholder copy on both axes", async () => {
    mockFetch({ status: {} });
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    fireEvent.click(screen.getByText("Live version"));

    const placeholder = screen.getByTestId("device-placeholder");
    for (const token of ["flex", "items-center", "justify-center", "text-center"]) {
      expect(placeholder.className).toContain(token);
    }
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
    expect(withOverrides("https://r.test/a.html?x=1", { user: { plan: "go" } })).toContain(
      "&sw_user=",
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
      { kind: "paywall", id: "plus-upgrade", routes: [], locales: [] },
      "push",
      (step, state) => steps.push(`${step}:${state}`),
    );

    expect(steps).toEqual(["build:start", "build:done", "push:start", "push:done"]);
    expect(result).toEqual({ ok: true, version: 7, live: false });
  });
});

describe("runAction framing", () => {
  const streamOf = (...chunks: string[]) =>
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

  const withBody = (body: ReadableStream | undefined) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, body }) as unknown as Response),
    );

  const surface = { kind: "paywall" as const, id: "plus-upgrade", routes: [], locales: [] };

  it("reassembles events split across chunk boundaries", async () => {
    withBody(
      streamOf(
        '{"step":"link","sta',
        'te":"start"}\n{"step":"link","state":"done"}\n{"ste',
        'p":"build","state":"start"}\n',
        '{"step":"build","state":"done"}\n{"result":{"ok":true,"version":9,"live":true}}',
      ),
    );

    const steps: string[] = [];
    const result = await runAction(surface, "publish", (step, state) =>
      steps.push(`${step}:${state}`),
    );

    expect(steps).toEqual(["link:start", "link:done", "build:start", "build:done"]);
    expect(result).toEqual({ ok: true, version: 9, live: true });
  });

  it("ignores blank lines and tolerates a stream with no trailing newline", async () => {
    withBody(
      streamOf(
        '\n\n{"step":"push","state":"done"}\n\n{"result":{"ok":true,"version":1,"live":false}}',
      ),
    );

    const steps: string[] = [];
    const result = await runAction(surface, "push", (step, state) =>
      steps.push(`${step}:${state}`),
    );

    expect(steps).toEqual(["push:done"]);
    expect(result).toEqual({ ok: true, version: 1, live: false });
  });

  it("reports a stream that ends without a result rather than hanging", async () => {
    withBody(streamOf('{"step":"build","state":"start"}\n'));

    const result = await runAction(surface, "push");
    expect(result).toEqual({ ok: false, error: "The dev server closed without a result." });
  });

  it("falls back to a plain JSON body when the server does not stream", async () => {
    withBody(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            body: undefined,
            json: async () => ({ ok: false, error: "Actions need `superwall dev`." }),
          }) as unknown as Response,
      ),
    );

    expect(await runAction(surface, "push")).toEqual({
      ok: false,
      error: "Actions need `superwall dev`.",
    });
  });

  it("turns a thrown fetch into a result instead of rejecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("dev server went away");
      }),
    );

    expect(await runAction(surface, "push")).toEqual({
      ok: false,
      error: "dev server went away",
    });
  });

  it("a malformed line fails the action rather than being silently skipped", async () => {
    withBody(streamOf("{ not json }\n"));

    const result = await runAction(surface, "push");
    expect(result.ok).toBe(false);
  });
});
