import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
import { toast } from "sonner";
import { DownloadScreenshot } from "../../src/components/DownloadScreenshot";
import { StudioHostProvider, type StudioMode } from "../../src/lib/studio-host";
import type { StudioSource, StudioSurface } from "../../src/lib/surfaces";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const surface: StudioSurface = { kind: "paywall", id: "pro" } as StudioSurface;

const sourceWith = (extra: Partial<StudioSource> = {}): StudioSource =>
  ({ title: "app", surfaces: [surface], previewUrl: () => "", ...extra }) as StudioSource;

const mount = (mode: StudioMode, source: StudioSource) =>
  render(
    <StudioHostProvider mode={mode} home={{ href: "/", navigate: () => {} }}>
      <DownloadScreenshot source={source} surface={surface} />
    </StudioHostProvider>,
  );

const button = () => screen.getByRole("button", { name: "Download screenshot" });

const blocked = () => button().getAttribute("aria-disabled") === "true";

const hoverHint = async () => {
  fireEvent.mouseEnter(button().parentElement!);
  return (await screen.findByRole("tooltip")).textContent;
};

const captureAnchor = () => {
  const anchor = document.createElement("a");
  const clicked = vi.fn();
  anchor.click = clicked;
  vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
    tag === "a" ? anchor : document.createElementNS("http://www.w3.org/1999/xhtml", tag),
  );
  URL.createObjectURL = vi.fn().mockReturnValue("blob:shot");
  URL.revokeObjectURL = vi.fn();
  return { anchor, clicked };
};

describe("downloading a paywall's screenshot", () => {
  const localFetcher = (download: () => Promise<unknown>) =>
    vi.fn(async (input: unknown) =>
      String(input).includes("download=1")
        ? download()
        : { json: async () => ({ url: "https://cdn/local.png" }) },
    );

  it("saves the image through its own origin, named after the surface", async () => {
    const { anchor, clicked } = captureAnchor();
    const fetcher = localFetcher(async () => ({ ok: true, blob: async () => new Blob(["png"]) }));
    vi.stubGlobal("fetch", fetcher);

    mount("local", sourceWith());

    await waitFor(() => expect(blocked()).toBe(false));
    fireEvent.click(button());

    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe(
      "/__studio/screenshot/paywall/pro?download=1",
    );
    expect(anchor.getAttribute("href")).toBe("blob:shot");
    expect(anchor.download).toBe("pro.png");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:shot");
  });

  it("spins and stays disabled until the download has finished, then goes back to the icon", async () => {
    const { clicked } = captureAnchor();
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      localFetcher(() => new Promise((resolve) => (finish = resolve))),
    );

    mount("local", sourceWith());
    await waitFor(() => expect(blocked()).toBe(false));

    fireEvent.click(button());
    await waitFor(() => expect(button().getAttribute("aria-busy")).toBe("true"));
    expect(blocked()).toBe(true);
    expect(button().querySelector(".animate-spin")).not.toBeNull();
    fireEvent.mouseEnter(button().parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(button());
    finish({ ok: true, blob: async () => new Blob(["png"]) });

    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(blocked()).toBe(false));
    expect(button().getAttribute("aria-busy")).toBeNull();
    expect(button().querySelector(".animate-spin")).toBeNull();
  });

  it("says so and re-enables itself when the dev server cannot hand the file over", async () => {
    const { clicked } = captureAnchor();
    vi.stubGlobal(
      "fetch",
      localFetcher(async () => ({ ok: false, status: 502 })),
    );

    const toasted = vi.spyOn(toast, "custom").mockReturnValue(1);

    mount("local", sourceWith());
    await waitFor(() => expect(blocked()).toBe(false));
    fireEvent.click(button());

    await waitFor(() => expect(toasted).toHaveBeenCalledTimes(1));
    const content = toasted.mock.calls[0]?.[0] as (() => React.ReactNode) | undefined;
    expect(content).toBeDefined();
    const card = render(<>{content?.()}</>);
    expect(card.container.textContent).toContain("the dev server answered 502");
    await waitFor(() => expect(blocked()).toBe(false));
    expect(clicked).not.toHaveBeenCalled();
  });

  it("stays disabled and says what is missing when nothing has been promoted", async () => {
    mount("hosted", sourceWith({ screenshotUrl: async () => undefined }));

    await waitFor(() => expect(blocked()).toBe(true));
    expect(await hoverHint()).toContain("promote a pushed version");
  });

  it("names the failure in the tooltip when the service cannot be reached", async () => {
    mount(
      "hosted",
      sourceWith({
        screenshotUrl: async () => {
          throw new Error("preview API responded 503");
        },
      }),
    );

    await waitFor(() => expect(blocked()).toBe(true));
    expect(await hoverHint()).toBe("preview API responded 503");
  });

  it("asks its own dev server when local, which knows the bound paywall", async () => {
    const { clicked } = captureAnchor();
    const fetcher = localFetcher(async () => ({ ok: true, blob: async () => new Blob(["png"]) }));
    vi.stubGlobal("fetch", fetcher);

    mount("local", sourceWith());

    await waitFor(() => expect(blocked()).toBe(false));
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("/__studio/screenshot/paywall/pro");

    fireEvent.click(button());
    await waitFor(() => expect(clicked).toHaveBeenCalled());
  });

  it("downloads straight from the image host when hosted", async () => {
    const { anchor, clicked } = captureAnchor();
    const fetcher = vi.fn(async (_input: unknown) => ({
      ok: true,
      blob: async () => new Blob(["png"]),
    }));
    vi.stubGlobal("fetch", fetcher);
    mount("hosted", sourceWith({ screenshotUrl: async () => "https://cdn/shot.png" }));

    await waitFor(() => expect(blocked()).toBe(false));
    fireEvent.click(button());

    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://cdn/shot.png");
    expect(anchor.getAttribute("href")).toBe("blob:shot");
    expect(anchor.download).toBe("pro.png");
  });

  it("falls back to opening the image when the host refuses a cross-origin read", async () => {
    const { anchor, clicked } = captureAnchor();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const toasted = vi.spyOn(toast, "custom").mockReturnValue(1);
    mount("hosted", sourceWith({ screenshotUrl: async () => "https://cdn/shot.png" }));

    await waitFor(() => expect(blocked()).toBe(false));
    fireEvent.click(button());

    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(anchor.getAttribute("href")).toBe("https://cdn/shot.png");
    expect(anchor.target).toBe("_blank");
    expect(toasted).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(blocked()).toBe(false));
  });
});
