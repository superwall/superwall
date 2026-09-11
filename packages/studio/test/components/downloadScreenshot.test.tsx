import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("saves the image through its own origin, named after the surface", async () => {
    const { anchor, clicked } = captureAnchor();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ url: "https://cdn/local.png" }) })),
    );

    mount("local", sourceWith());

    await waitFor(() => expect(blocked()).toBe(false));
    fireEvent.click(button());

    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(anchor.getAttribute("href")).toBe("/__studio/screenshot/paywall/pro?download=1");
    expect(anchor.download).toBe("pro.png");
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
    const fetcher = vi.fn(async (input: unknown) =>
      String(input).startsWith("/__studio/screenshot")
        ? { json: async () => ({ url: "https://cdn/local.png" }) }
        : { ok: true, blob: async () => new Blob(["png"]) },
    );
    vi.stubGlobal("fetch", fetcher);

    mount("local", sourceWith());

    await waitFor(() => expect(blocked()).toBe(false));
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("/__studio/screenshot/paywall/pro");

    fireEvent.click(button());
    await waitFor(() => expect(clicked).toHaveBeenCalled());
  });

  it("opens the image when hosted, where there is no proxy to download through", async () => {
    const { anchor, clicked } = captureAnchor();
    mount("hosted", sourceWith({ screenshotUrl: async () => "https://cdn/shot.png" }));

    await waitFor(() => expect(blocked()).toBe(false));
    fireEvent.click(button());

    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(anchor.getAttribute("href")).toBe("https://cdn/shot.png");
    expect(anchor.target).toBe("_blank");
  });
});
