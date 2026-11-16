import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner, updatePrompt } from "../../src/components/UpdateBanner";
import type { StudioUpdate } from "../../src/lib/contract";

const update = (overrides: Partial<StudioUpdate> = {}): StudioUpdate => ({
  current: "2.5.2",
  latest: "2.5.3",
  kind: "patch",
  command: "superwall upgrade",
  notes: "https://github.com/superwall/superwall/releases/tag/v2.5.3",
  ...overrides,
});

const MAJOR = update({
  latest: "3.0.0",
  kind: "major",
  command: "cd superwall && pnpm add superwall@latest",
  notes: "https://github.com/superwall/superwall/releases/tag/v3.0.0",
});

afterEach(() => vi.restoreAllMocks());

describe("the studio's update banner", () => {
  it("renders nothing without an update", () => {
    const { container } = render(<UpdateBanner update={undefined} />);

    expect(container.innerHTML).toBe("");
  });

  it.each(["patch", "minor"] as const)(
    "shows a %s quietly, with the command and no release notes",
    (kind) => {
      render(<UpdateBanner update={update({ kind })} />);

      const banner = screen.getByRole("status");
      expect(banner.textContent).toContain("Update available");
      expect(banner.textContent).toContain("superwall 2.5.2 → 2.5.3");
      expect(banner.textContent).not.toContain("breaking");
      expect(screen.getByRole("button", { name: "Copy prompt" })).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("warns about a major, links its release notes and gives the project's command", () => {
    render(<UpdateBanner update={MAJOR} />);

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Major update available");
    expect(banner.textContent).toContain("may contain breaking changes");
    expect(screen.getByRole("link", { name: /Release notes/ }).getAttribute("href")).toBe(
      MAJOR.notes,
    );
    const copy = screen.getByRole("button", { name: "Copy prompt" });
    expect(copy.className).toContain("text-warning-foreground");
    expect(copy.className).not.toContain("sw-btn");
    expect(copy.getAttribute("title")).toBe(MAJOR.command);
    const dismiss = screen.getByRole("button", { name: "Dismiss" }).className;
    expect(dismiss).toContain("sw-btn--ghost");
    expect(dismiss).toContain("[&>.sw-icon]:text-warning-foreground");
  });

  it("dismisses with a square button the size of the top bar's buttons", () => {
    render(<UpdateBanner update={update()} />);

    const dismiss = screen.getByRole("button", { name: "Dismiss" }).className;
    expect(dismiss).toContain("sw-btn--sm");
    expect(dismiss).toContain("sw-btn--icon");
    expect(dismiss).toContain("sw-btn--ghost");
  });

  it("prompts an agent to review breaking changes before a major upgrade", () => {
    const prompt = updatePrompt(MAJOR);

    expect(prompt).toContain("from 2.5.2 to 3.0.0");
    expect(prompt).toContain("may contain breaking changes");
    expect(prompt).toContain(MAJOR.notes);
    expect(prompt).toContain("https://github.com/superwall/superwall/releases)");
    expect(prompt).toContain("Before you change anything, tell me what will break");
    expect(prompt).toContain("`cd superwall && pnpm add superwall@latest`");
    expect(prompt).toContain("`superwall build`");
  });

  it("prompts a short upgrade for a patch or minor", () => {
    const prompt = updatePrompt(update());

    expect(prompt).toContain("from 2.5.2 to 2.5.3");
    expect(prompt).not.toContain("breaking");
    expect(prompt).toContain(update().notes);
    expect(prompt).toContain("`superwall upgrade`");
  });

  it("copies the upgrade prompt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<UpdateBanner update={MAJOR} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    expect(writeText).toHaveBeenCalledWith(updatePrompt(MAJOR));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("stays hidden for that version once dismissed, and comes back for a newer one", () => {
    const first = render(<UpdateBanner update={update()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
    first.unmount();

    const again = render(<UpdateBanner update={update()} />);
    expect(screen.queryByRole("status")).toBeNull();
    again.unmount();

    render(<UpdateBanner update={update({ latest: "2.5.4" })} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("still shows and dismisses when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<UpdateBanner update={update()} />);

    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
