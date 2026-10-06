import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewOnDevice } from "../../src/components/PreviewOnDevice";
import { StudioHostProvider, type StudioMode } from "../../src/lib/studio-host";
import type { StudioSource, StudioSurface } from "../../src/lib/surfaces";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const surface: StudioSurface = { kind: "paywall", id: "pro" } as StudioSurface;

const sourceWith = (extra: Partial<StudioSource> = {}): StudioSource =>
  ({ title: "app", surfaces: [surface], previewUrl: () => "", ...extra }) as StudioSource;

const mount = (mode: StudioMode, source: StudioSource) =>
  render(
    <StudioHostProvider mode={mode} home={{ href: "/", navigate: () => {} }}>
      <PreviewOnDevice source={source} surface={surface} />
    </StudioHostProvider>,
  );

const openDialog = () => fireEvent.click(screen.getByRole("button", { name: "Preview" }));

describe("previewing a surface on a device", () => {
  it("points a local studio at this machine's dev server, naming the surface", async () => {
    // `superwall_dev` is the dev server base and `superwall_dev_surface` the
    // surface to open with — the pair the SDK's DevServerPreview parses.
    mount("local", sourceWith({ scheme: "myapp" }));
    openDialog();

    const link = await screen.findByText(/^myapp:\/\//);
    expect(link.textContent).toBe(
      `myapp://?superwall_dev=${encodeURIComponent(window.location.origin)}&superwall_dev_surface=pro`,
    );
  });

  it("uses the address a phone can reach, not the one the studio is open on", async () => {
    // `superwall dev` binds to the network; the studio is usually browsed on
    // localhost, which on a phone is the phone.
    mount("local", sourceWith({ scheme: "myapp", networkOrigin: "http://192.168.1.109:6101" }));
    openDialog();

    const link = await screen.findByText(/^myapp:\/\//);
    expect(link.textContent).toBe(
      `myapp://?superwall_dev=${encodeURIComponent("http://192.168.1.109:6101")}&superwall_dev_surface=pro`,
    );
  });

  it("asks the host for a link when hosted, because there is no dev server", async () => {
    const previewLink = vi.fn().mockResolvedValue("https://dash.example/preview?sat=token");
    mount("hosted", sourceWith({ previewLink }));
    openDialog();

    const open = await screen.findByRole("link", { name: "Open preview" });
    expect(open.getAttribute("href")).toBe("https://dash.example/preview?sat=token");
    expect(screen.queryByText("https://dash.example/preview?sat=token")).toBeNull();
    expect(previewLink).toHaveBeenCalledWith(surface);
  });

  it("says so rather than showing a broken code when the host cannot build one", async () => {
    mount("hosted", sourceWith());
    openDialog();

    expect(await screen.findByText(/can’t open paywalls on a device/)).toBeTruthy();
  });

  it("asks for the URL scheme when the project has not declared one", async () => {
    mount("local", sourceWith());
    openDialog();

    expect(await screen.findByText(/Set your app’s URL scheme/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set URL scheme" })).toBeTruthy();
  });

  it("remembers a scheme typed by hand, so the next preview needs no prompt", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("typed");
    mount("local", sourceWith());
    openDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Set URL scheme" }));

    const link = await screen.findByText(/^typed:\/\//);
    expect(link.textContent).toContain("superwall_dev=");
    expect(window.localStorage.getItem("superwall-device-scheme")).toBe("typed");
    prompt.mockRestore();
  });

  it("closes from Done, from Escape, and from a click on the backdrop", () => {
    mount("local", sourceWith({ scheme: "myapp" }));
    const dialog = () => screen.queryByRole("dialog", { name: "Preview on a device" });

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(dialog()).toBeNull();

    openDialog();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(dialog()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dialog()).toBeNull();

    openDialog();
    fireEvent.mouseDown(dialog()!);
    expect(dialog()).not.toBeNull();
    fireEvent.mouseDown(dialog()!.parentElement!);
    expect(dialog()).toBeNull();
  });
});
