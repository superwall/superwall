import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceFrame } from "../src/components/DeviceFrame";
import { deviceById } from "../src/lib/devices";

/**
 * The double-buffer contract: a src change loads a second, hidden iframe
 * while the current one stays visible; after the new frame loads (plus the
 * paint grace period) the old frame is dropped — no white flash.
 */

const device = deviceById("iphone-17");

const Harness = ({ src, reloadKey = 0 }: { src: string; reloadKey?: number }) => {
  const stageRef = React.useRef<HTMLDivElement>(null);
  return (
    <div ref={stageRef}>
      <DeviceFrame
        width={device.width}
        height={device.height}
        title="preview"
        src={src}
        stageRef={stageRef}
        reloadKey={reloadKey}
      />
    </div>
  );
};

const frames = () => screen.getAllByTitle("preview");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DeviceFrame double buffering", () => {
  it("renders a single frame initially", () => {
    render(<Harness src="/preview/paywall/a" />);
    expect(frames()).toHaveLength(1);
  });

  it("keeps the old frame visible until the new one loads, then swaps", () => {
    const view = render(<Harness src="/preview/paywall/a" />);

    view.rerender(<Harness src="/preview/paywall/a?theme=dark" />);
    // Both frames mounted: old still current, new loading underneath.
    expect(frames()).toHaveLength(2);

    fireEvent.load(frames()[1]);
    act(() => {
      vi.runAllTimers();
    });

    // Old frame dropped; the survivor is the new src.
    const remaining = frames();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].getAttribute("src")).toBe("/preview/paywall/a?theme=dark");
  });

  it("abandons a stale pending frame when the src changes again", () => {
    const view = render(<Harness src="/preview/paywall/a" />);

    view.rerender(<Harness src="/preview/paywall/a?v=1" />);
    const stale = frames()[1];
    view.rerender(<Harness src="/preview/paywall/a?v=2" />);

    // Original + newest pending only — the v=1 frame was abandoned.
    const mounted = frames();
    expect(mounted).toHaveLength(2);
    expect(mounted.map((frame) => frame.getAttribute("src"))).toEqual([
      "/preview/paywall/a",
      "/preview/paywall/a?v=2",
    ]);

    // A late load event from the abandoned frame must not disturb anything.
    fireEvent.load(stale);
    act(() => {
      vi.runAllTimers();
    });
    expect(frames()).toHaveLength(2);

    fireEvent.load(frames()[1]);
    act(() => {
      vi.runAllTimers();
    });
    expect(frames()).toHaveLength(1);
    expect(frames()[0].getAttribute("src")).toBe("/preview/paywall/a?v=2");
  });

  it("reloadKey forces a fresh frame for the same src", () => {
    const view = render(<Harness src="/preview/paywall/a" />);
    view.rerender(<Harness src="/preview/paywall/a" reloadKey={1} />);
    expect(frames()).toHaveLength(2);
  });

  it("applies query-only changes in place instead of remounting", () => {
    const view = render(<Harness src="/preview/paywall/a" />);
    const frame = frames()[0] as HTMLIFrameElement;
    const apply = vi.fn();
    (frame.contentWindow as Window & { __swPreviewApply?: (s: string) => void }).__swPreviewApply =
      apply;

    view.rerender(<Harness src="/preview/paywall/a?theme=dark" />);
    expect(apply).toHaveBeenCalledWith("?theme=dark");
    // still one frame — nothing reloaded
    expect(frames().length).toBe(1);

    // a different document still swaps via the double buffer
    view.rerender(<Harness src="/preview/paywall/b" />);
    expect(frames().length).toBe(2);
  });
});
