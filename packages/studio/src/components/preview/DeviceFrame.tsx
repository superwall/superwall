import * as React from "react";
import type { HostDelegate, HostState } from "@superwall/host";
import { DeviceChrome } from "./DeviceChrome";
import { HostedIframe } from "./HostedIframe";
import type { DeviceChromeSpec } from "../../lib/devices";
import { presentationRect, type StudioPresentation } from "../../lib/presentation";

const FRAME_MARGIN = 96;

const SWAP_DELAY_MS = 250;

const useFitScale = (stage: HTMLElement | null, width: number, height: number): number => {
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    if (!stage) return undefined;

    const fit = () => {
      const available = stage.getBoundingClientRect();
      const next = Math.min(
        1,
        (available.width - FRAME_MARGIN) / width,
        (available.height - FRAME_MARGIN) / height,
      );
      setScale(Math.max(0.1, next));
    };

    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage, width, height]);

  return scale;
};

export const DevicePlaceholder = ({
  width,
  height,
  stage,
  children,
}: React.PropsWithChildren<{
  width: number;
  height: number;
  stage: HTMLElement | null;
}>) => {
  const scale = useFitScale(stage, width, height);

  return (
    <div
      className="flex flex-none items-center justify-center overflow-hidden border border-dashed border-cream/20 p-6 text-center text-sm text-cream/55"
      data-testid="device-placeholder"
      style={{ width: width * scale, height: height * scale }}
    >
      {children}
    </div>
  );
};

type Frame = {
  src: string;
  generation: number;
  ready: boolean;
};

export const DeviceFrame = ({
  width,
  height,
  title,
  src,
  hostState,
  delegate,
  stage,
  reloadKey = 0,
  chrome,
  presentation,
  landscape = false,
  theme = "light",
}: {
  width: number;
  height: number;
  title: string;
  src: string;
  hostState: HostState;
  delegate: HostDelegate;
  stage: HTMLElement | null;
  reloadKey?: number;
  chrome?: DeviceChromeSpec;
  presentation?: StudioPresentation;
  landscape?: boolean;
  theme?: "light" | "dark";
}) => {
  const scale = useFitScale(stage, width, height);

  const generation = React.useRef(0);
  const [frames, setFrames] = React.useState<Frame[]>([{ src, generation: 0, ready: true }]);

  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    generation.current += 1;
    const next: Frame = { src, generation: generation.current, ready: false };
    setFrames((existing) => [...existing.filter((frame) => frame.ready).slice(-1), next]);
  }, [src, reloadKey]);

  const commit = (committed: number) => {
    window.setTimeout(() => {
      setFrames((existing) => {
        if (!existing.some((frame) => frame.generation === committed)) return existing;
        return existing
          .map((frame) => (frame.generation === committed ? { ...frame, ready: true } : frame))
          .filter((frame) => frame.generation >= committed);
      });
    }, SWAP_DELAY_MS);
  };

  const visible = frames.findLast((frame) => frame.ready);

  const radius = chrome ? chrome.radius * scale : 0;
  const sheet = presentationRect(presentation, { width, height });
  const page = sheet ?? { x: 0, y: 0, width, height, radius: { top: 0, bottom: 0 } };
  const dark = theme === "dark";

  return (
    <div
      className={`bg-panel relative flex-none overflow-hidden ${
        chrome ? "shadow-[0_0_0_1px] shadow-cream/25" : "border border-cream/20"
      }`}
      data-testid="device-frame"
      style={{ width: width * scale, height: height * scale, borderRadius: radius }}
    >
      {sheet && (
        <div
          className="absolute inset-0 origin-top-left"
          data-testid="presentation-backdrop"
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            background: dark
              ? "repeating-linear-gradient(-45deg, #1c1f26 0 7px, #171a20 7px 20px)"
              : "repeating-linear-gradient(-45deg, #e3e3e3 0 7px, #ededed 7px 20px)",
          }}
        >
          {sheet.underlay && (
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: sheet.y - 12,
                width: Math.round(width * 0.92),
                height: 30,
                borderRadius: "20px 20px 0 0",
                background: dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.3)",
              }}
            />
          )}
        </div>
      )}
      <div
        className="absolute overflow-hidden"
        data-testid="presentation-page"
        style={{
          left: page.x * scale,
          top: page.y * scale,
          width: page.width * scale,
          height: page.height * scale,
          borderRadius: `${page.radius.top * scale}px ${page.radius.top * scale}px ${page.radius.bottom * scale}px ${page.radius.bottom * scale}px`,
          boxShadow: sheet ? "0 0 40px rgba(0,0,0,0.25)" : undefined,
        }}
      >
        {frames.map((frame) => (
          <HostedIframe
            key={frame.generation}
            hostState={hostState}
            delegate={delegate}
            className={`absolute inset-0 origin-top-left border-0 bg-white transition-opacity duration-150 ${
              frame === visible ? "opacity-100" : "opacity-0"
            }`}
            title={title}
            src={frame.src}
            width={page.width}
            height={page.height}
            style={{ transform: `scale(${scale})` }}
            onLoad={() => {
              if (!frame.ready) commit(frame.generation);
            }}
          />
        ))}
      </div>
      {chrome && (
        <div
          className="pointer-events-none absolute inset-0 origin-top-left"
          style={{ width, height, transform: `scale(${scale})` }}
        >
          <DeviceChrome
            spec={chrome}
            width={width}
            height={height}
            landscape={landscape}
            theme={theme}
          />
        </div>
      )}
    </div>
  );
};
