import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceEditor } from "../../src/screens/SurfaceEditor";
import type { StudioHandle } from "../../src/lib/commands";
import { snapshotPreviewUrl } from "../../src/lib/preview";
import { StudioHostProvider } from "../../src/lib/studio-host";
import type { StudioDraft, StudioSource, StudioSurface } from "../../src/lib/surfaces";

/**
 * A chat's builds: one on stage (the draft studio's surface), the others
 * compared beside it, the way web2 hosts an agent's variants.
 */
const onStage: StudioSurface = {
  kind: "paywall",
  id: "variant-a",
  label: "variant-a · draft",
  routes: [],
  locales: [],
  products: {},
};

const draft = (id: string, extra: Partial<StudioDraft> = {}): StudioDraft => ({
  key: id,
  label: `${id} · draft`,
  url: `https://agent.test/paywall-preview/${id}`,
  ...extra,
});

const sourceWith = (drafts: StudioDraft[], selectDraft?: (key: string) => void): StudioSource => ({
  title: "variant-a",
  surfaces: [onStage],
  previewUrl: snapshotPreviewUrl(() => "https://agent.test/paywall-preview/variant-a"),
  drafts,
  ...(selectDraft ? { selectDraft } : {}),
});

const renderEditor = (element: React.ReactElement) =>
  render(
    <StudioHostProvider mode="hosted" home={{ href: "/", navigate: () => {} }}>
      {element}
    </StudioHostProvider>,
  );

const drive = async (
  handle: React.RefObject<StudioHandle | null>,
  commands: Parameters<StudioHandle["run"]>[0],
) => {
  let result: Awaited<ReturnType<StudioHandle["run"]>> | undefined;
  let running: ReturnType<StudioHandle["run"]> | undefined;
  act(() => {
    running = handle.current?.run(commands);
  });
  await act(async () => {
    result = await running;
  });
  if (!result) throw new Error("the editor did not answer");
  return result;
};

const paneOrder = (title: string): string | undefined =>
  (screen.getByTitle(title).closest(".flex-col.gap-2") as HTMLElement | null)?.style.order;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SurfaceEditor comparing a host's drafts", () => {
  const three = [draft("variant-a", { onStage: true }), draft("variant-b"), draft("variant-c")];

  it("opens in compare with every build side by side, in the order they were built", () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(
      <SurfaceEditor ref={handle} source={sourceWith(three)} surface={onStage} samples={{}} />,
    );
    const b = screen.getByTitle("variant-b · draft preview") as HTMLIFrameElement;
    expect(b.src).toContain("https://agent.test/paywall-preview/variant-b");
    expect(b.src).toContain("transport=editor");
    expect(screen.getByTitle("variant-c · draft preview")).toBeTruthy();
    expect([
      paneOrder("variant-a preview"),
      paneOrder("variant-b · draft preview"),
      paneOrder("variant-c · draft preview"),
    ]).toEqual(["100", "101", "102"]);
    expect(screen.getByText("variant-a · draft")).toBeTruthy();

    const state = handle.current!.state();
    expect(state.stage).toBe("draft:variant-a");
    expect(state.compare).toEqual(["draft:variant-b", "draft:variant-c"]);
    expect(state.compareMax).toBe(2);
    expect(state.drafts).toEqual([
      { key: "draft:variant-a", label: "variant-a · draft", onStage: true },
      { key: "draft:variant-b", label: "variant-b · draft", onStage: false },
      { key: "draft:variant-c", label: "variant-c · draft", onStage: false },
    ]);
    expect(state.compareOptions[0]).toEqual({
      key: "draft:variant-b",
      label: "variant-b · draft",
      kind: "draft",
    });
  });

  it("shows three at most, a newer build replacing the oldest and the rest still listed", () => {
    const handle = React.createRef<StudioHandle>();
    const view = renderEditor(
      <SurfaceEditor ref={handle} source={sourceWith(three)} surface={onStage} samples={{}} />,
    );
    view.rerender(
      <StudioHostProvider mode="hosted" home={{ href: "/", navigate: () => {} }}>
        <SurfaceEditor
          ref={handle}
          source={sourceWith([...three, draft("variant-d")])}
          surface={onStage}
          samples={{}}
        />
      </StudioHostProvider>,
    );
    const state = handle.current!.state();
    expect(state.compare).toEqual(["draft:variant-c", "draft:variant-d"]);
    expect(state.compareOptions.map((option) => option.key)).toContain("draft:variant-b");
    expect(screen.queryByTitle("variant-b · draft preview")).toBeNull();
  });

  it("sets, adds, removes and swaps what is compared on command", async () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(
      <SurfaceEditor
        ref={handle}
        source={sourceWith([...three, draft("variant-d")])}
        surface={onStage}
        samples={{}}
      />,
    );
    const set = await drive(handle, [{ type: "compare", with: ["variant-a", "variant-b"] }]);
    expect(set.errors).toEqual([]);
    expect(set.state.compare).toEqual(["draft:variant-b"]);

    const added = await drive(handle, [
      { type: "compareAdd", with: "variant-d · draft" },
      { type: "compareAdd", with: "draft:variant-c" },
    ]);
    expect(added.state.compare).toEqual(["draft:variant-c", "draft:variant-d"]);

    const swapped = await drive(handle, [
      { type: "compareSwap", from: "variant-c", to: "variant-b" },
      { type: "compareRemove", with: "variant-d" },
    ]);
    expect(swapped.state.compare).toEqual(["draft:variant-b"]);

    const refused = await drive(handle, [
      { type: "compare", with: ["variant-b", "variant-c", "variant-d"] },
      { type: "compare", with: ["nope"] },
      { type: "compareAdd", with: "variant-a" },
      { type: "compareAdd", with: "nope" },
      { type: "compareRemove", with: "nope" },
      { type: "compareSwap", from: "variant-d", to: "variant-c" },
      { type: "compareSwap", from: "variant-b", to: "variant-a" },
      { type: "compareSwap", from: "variant-b", to: "nope" },
    ]);
    expect(refused.errors.map((error) => error.error)).toEqual([
      "the stage compares at most 2 beside the one on it; put another on stage with select",
      'nothing to compare called "nope"; see state.compareOptions',
      "variant-a is on stage already",
      'nothing to compare called "nope"; see state.compareOptions',
      'nothing to compare called "nope"; see state.compareOptions',
      '"variant-d" is not compared; see state.compare',
      "variant-a is on stage already",
      'nothing to compare called "nope"; see state.compareOptions',
    ]);

    const off = await drive(handle, [{ type: "compare", with: [] }]);
    expect(off.state.compare).toEqual([]);
    expect(screen.queryByText("variant-a · draft")).toBeNull();
  });

  it("puts a draft on stage through the host, by command or by its pane's Open", async () => {
    const selectDraft = vi.fn();
    const handle = React.createRef<StudioHandle>();
    renderEditor(
      <SurfaceEditor
        ref={handle}
        source={sourceWith(three, selectDraft)}
        surface={onStage}
        samples={{}}
      />,
    );
    const result = await drive(handle, [
      { type: "select", with: "variant-c" },
      { type: "select", with: "variant-a · draft" },
      { type: "select", with: "nope" },
    ]);
    expect(selectDraft).toHaveBeenCalledOnce();
    expect(selectDraft).toHaveBeenCalledWith("variant-c");
    expect(result.errors).toEqual([
      { index: 2, type: "select", error: 'no draft called "nope"; see state.drafts' },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Open variant-b · draft" }));
    expect(selectDraft).toHaveBeenLastCalledWith("variant-b");

    fireEvent.click(screen.getByRole("button", { name: "Stop comparing variant-b · draft" }));
    expect(handle.current!.state().compare).toEqual(["draft:variant-c"]);
  });

  it("answers a select that moves the host to another editor, rather than never", async () => {
    const handle = React.createRef<StudioHandle>();
    const Host = () => {
      const [stage, setStage] = React.useState("variant-a");
      const drafts = three.map((entry) => ({ ...entry, onStage: entry.key === stage }));
      return (
        <SurfaceEditor
          key={stage}
          ref={handle}
          source={sourceWith(drafts, setStage)}
          surface={{ ...onStage, id: stage }}
          samples={{}}
        />
      );
    };
    renderEditor(<Host />);
    const result = await drive(handle, [{ type: "select", with: "variant-b" }]);
    expect(result.ok).toBe(true);
    expect(handle.current!.state().stage).toBe("draft:variant-b");
  });

  it("says when it cannot put another build on stage, or when a version is asked for", async () => {
    const handle = React.createRef<StudioHandle>();
    const versioned: StudioSource = {
      ...sourceWith(three),
      actions: {
        offered: ["promote"],
        run: vi.fn(),
        status: async () => ({
          versions: [{ version: 3, url: "https://cdn.test/3.html", live: true }],
        }),
      },
    };
    renderEditor(<SurfaceEditor ref={handle} source={versioned} surface={onStage} samples={{}} />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Open variant-b · draft" })).toBeNull();
    const result = await drive(handle, [
      { type: "select", with: "variant-b" },
      { type: "select", with: "version:3" },
      { type: "compareSwap", from: "variant-b", to: "v3 · Live" },
    ]);
    expect(result.errors.map((error) => error.error)).toEqual([
      "this studio cannot put another build on stage",
      "version:3 is a pushed version; show it with version",
    ]);
    // A draft can be compared against live.
    expect(result.state.compare).toEqual(["version:3", "draft:variant-c"]);
    expect(screen.getByTitle("variant-a v3")).toBeTruthy();
  });

  it("opens and closes Preview on a device on command, asking to push an unsaved paywall first", async () => {
    const handle = React.createRef<StudioHandle>();
    const unsaved: StudioSource = {
      ...sourceWith(three),
      actions: { offered: ["push", "publish"], run: vi.fn(), status: async () => ({}) },
    };
    renderEditor(<SurfaceEditor ref={handle} source={unsaved} surface={onStage} samples={{}} />);
    await act(async () => {});
    const opened = await drive(handle, [{ type: "previewOnDevice", open: true }]);
    expect(screen.getByRole("dialog", { name: "Push this paywall first?" })).toBeTruthy();
    expect(opened.state.previewOnDevice).toBe(true);
    const closed = await drive(handle, [{ type: "previewOnDevice", open: false }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(closed.state.previewOnDevice).toBe(false);
  });

  it("opens Preview on a device straight away for a saved paywall", async () => {
    const handle = React.createRef<StudioHandle>();
    renderEditor(
      <SurfaceEditor
        ref={handle}
        source={{ ...sourceWith([]), previewLink: async () => "https://dash.test/preview" }}
        surface={{ ...onStage, paywallId: "1" }}
        samples={{}}
      />,
    );
    await drive(handle, [{ type: "previewOnDevice", open: true }]);
    expect(screen.getByRole("dialog", { name: "Preview on a device" })).toBeTruthy();
  });
});
