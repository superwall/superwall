import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostState, recordingDelegate, type HostState } from "@superwall/host";
import { DeviceFrame, DevicePlaceholder } from "../../../src/components/preview/DeviceFrame";
import { deviceById } from "../../../src/lib/devices";

/**
 * The double-buffer contract: a src change loads a second, hidden iframe
 * while the current one stays visible; after the new frame loads (plus the
 * paint grace period) the old frame is dropped — no white flash. Every frame
 * is hosted from the moment it mounts, so the paywall's ping is answered
 * whichever generation sends it.
 */

const device = deviceById("iphone-17");

const initialState = createHostState({
  paywallId: "1",
  paywallIdentifier: "plus",
  device: { platform: "iOS" },
});

const Harness = ({
  src,
  reloadKey = 0,
  hostState = initialState,
}: {
  src: string;
  reloadKey?: number;
  hostState?: HostState;
}) => {
  return (
    <div>
      <DeviceFrame
        width={device.width}
        height={device.height}
        title="preview"
        src={src}
        hostState={hostState}
        delegate={recordingDelegate()}
        reloadKey={reloadKey}
      />
    </div>
  );
};

const frames = () => screen.getAllByTitle("preview");

const frameWindow = (frame: HTMLElement): Window => {
  if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) {
    throw new Error("iframe without a window");
  }
  return frame.contentWindow;
};

const ping = (target: Window) =>
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

const posted = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map(([message]) => {
    if (typeof message !== "string") throw new Error("host must post strings");
    const envelope: { payload: { events: { event_name: string }[] } } = JSON.parse(message);
    return envelope.payload.events;
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DeviceFrame double buffering", () => {
  it("renders a single frame initially", () => {
    render(<Harness src="/preview/paywall/a" />);
    expect(frames()).toHaveLength(1);
  });

  it("keeps the old frame visible until the new one loads, then swaps", () => {
    const view = render(<Harness src="/preview/paywall/a" />);

    view.rerender(<Harness src="/preview/paywall/b" />);
    expect(frames()).toHaveLength(2);

    fireEvent.load(frames()[1]);
    act(() => {
      vi.runAllTimers();
    });

    const remaining = frames();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].getAttribute("src")).toBe("/preview/paywall/b");
  });

  it("abandons a stale pending frame when the src changes again", () => {
    const view = render(<Harness src="/preview/paywall/a" />);

    view.rerender(<Harness src="/preview/paywall/a?v=1" />);
    const stale = frames()[1];
    view.rerender(<Harness src="/preview/paywall/a?v=2" />);

    const mounted = frames();
    expect(mounted).toHaveLength(2);
    expect(mounted.map((frame) => frame.getAttribute("src"))).toEqual([
      "/preview/paywall/a",
      "/preview/paywall/a?v=2",
    ]);

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
});

describe("DeviceFrame as a host", () => {
  it("answers the frame's ping with the host burst, as a string envelope", () => {
    render(<Harness src="/preview/paywall/a" />);
    const target = frameWindow(frames()[0]);
    const post = vi.spyOn(target, "postMessage").mockImplementation(() => {});

    act(() => {
      ping(target);
    });

    const [burst] = posted(post);
    expect(burst?.map((event) => event.event_name)).toEqual([
      "template_variables",
      "experiment",
      "products",
      "template_substitutions_prefix",
      "paywall_open",
    ]);
    expect(burst?.[4]).toEqual({
      event_name: "paywall_open",
      paywall_id: "1",
      paywall_identifier: "plus",
    });
  });

  it("re-sends template_variables when the host state changes, not a reload", () => {
    const view = render(<Harness src="/preview/paywall/a" />);
    const target = frameWindow(frames()[0]);
    const post = vi.spyOn(target, "postMessage").mockImplementation(() => {});

    view.rerender(
      <Harness
        src="/preview/paywall/a"
        hostState={createHostState({
          paywallId: "1",
          paywallIdentifier: "plus",
          device: { platform: "iOS", interfaceStyle: "Dark" },
        })}
      />,
    );

    expect(frames()).toHaveLength(1);
    const [update] = posted(post);
    expect(update?.map((event) => event.event_name)).toEqual(["template_variables"]);
    expect(update?.[0]).toMatchObject({
      variables: { device: { platform: "iOS", interfaceStyle: "Dark" } },
    });
  });

  it("ignores pings from windows it does not host", () => {
    render(<Harness src="/preview/paywall/a" />);
    const target = frameWindow(frames()[0]);
    const post = vi.spyOn(target, "postMessage").mockImplementation(() => {});

    act(() => {
      ping(window);
    });

    expect(post).not.toHaveBeenCalled();
  });
});

const Stage = ({ width, height }: { width: number; height: number }) => (
  <div>
    <DeviceFrame
      width={width}
      height={height}
      title="preview"
      src="/preview/paywall/a"
      hostState={initialState}
      delegate={recordingDelegate()}
    />
    <DevicePlaceholder width={width} height={height}>
      Nothing here
    </DevicePlaceholder>
  </div>
);

describe("DeviceFrame presentation", () => {
  it("gives a drawer paywall only the drawer's own viewport, over a backdrop", () => {
    render(
      <DeviceFrame
        width={device.width}
        height={device.height}
        title="preview"
        src="/preview/paywall/a"
        hostState={initialState}
        delegate={recordingDelegate()}
        presentation={{ style: "drawer", height: 50, cornerRadius: 24 }}
      />,
    );
    const frame = frames()[0];
    expect(frame.getAttribute("width")).toBe(String(device.width));
    expect(frame.getAttribute("height")).toBe(String(Math.round(device.height * 0.5)));
    expect(screen.getByTestId("presentation-backdrop")).toBeDefined();
    const page = screen.getByTestId("presentation-page");
    expect(page.style.top).toBe(`${device.height - Math.round(device.height * 0.5)}px`);
    expect(page.style.borderRadius).toBe("24px 24px 0px 0px");
  });

  it("lays the frame out at its logical size, leaving zoom to the canvas", () => {
    render(<Harness src="/preview/paywall/a" />);
    const frame = screen.getByTestId("device-frame");
    expect(frame.style.width).toBe(`${device.width}px`);
    expect(frame.style.height).toBe(`${device.height}px`);
    expect(frames()[0].style.transform).toBe("");
  });

  it("gives a fullscreen paywall the whole device and no backdrop", () => {
    render(<Harness src="/preview/paywall/a" />);
    expect(frames()[0].getAttribute("height")).toBe(String(device.height));
    expect(screen.queryByTestId("presentation-backdrop")).toBeNull();
  });
});

describe("DevicePlaceholder beside a DeviceFrame", () => {
  it("is exactly the size of the frame, and follows it when the hardware changes", () => {
    const view = render(<Stage width={device.width} height={device.height} />);
    const frame = screen.getByTestId("device-frame");
    const placeholder = screen.getByTestId("device-placeholder");
    expect(placeholder.style.width).toBe(frame.style.width);
    expect(placeholder.style.height).toBe(frame.style.height);
    expect(placeholder.style.width).not.toBe("");

    const before = frame.style.width;
    const ipad = deviceById("ipad-pro-11");
    view.rerender(<Stage width={ipad.width} height={ipad.height} />);
    expect(screen.getByTestId("device-frame").style.width).not.toBe(before);
    expect(screen.getByTestId("device-placeholder").style.width).toBe(
      screen.getByTestId("device-frame").style.width,
    );
  });

  it("centers the placeholder copy on both axes", () => {
    render(<Stage width={device.width} height={device.height} />);
    const placeholder = screen.getByTestId("device-placeholder");
    for (const token of ["flex", "items-center", "justify-center", "text-center"]) {
      expect(placeholder.className).toContain(token);
    }
  });
});
