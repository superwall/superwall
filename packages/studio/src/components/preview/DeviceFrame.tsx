import * as React from "react";
import type { HostDelegate, HostState } from "@superwall/host";
import { DeviceChrome, duoLayout } from "./DeviceChrome";
import { HostedIframe } from "./HostedIframe";
import type { DeviceChromeSpec } from "../../lib/devices";
import { presentationRect, type StudioPresentation } from "../../lib/presentation";

const SWAP_DELAY_MS = 250;

export const DevicePlaceholder = ({
  width,
  height,
  children,
}: React.PropsWithChildren<{
  width: number;
  height: number;
}>) => (
  <div
    className="flex flex-none items-center justify-center overflow-hidden rounded-sm bg-background p-6 text-center text-sm text-fg-secondary outline outline-foreground/20"
    data-testid="device-placeholder"
    style={{ width, height }}
  >
    {children}
  </div>
);

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
  reloadKey?: number;
  chrome?: DeviceChromeSpec;
  presentation?: StudioPresentation;
  landscape?: boolean;
  theme?: "light" | "dark";
}) => {
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

  const sheet = presentationRect(presentation, { width, height });
  const navigationBar = landscape ? 0 : (chrome?.navigationBarHeight ?? 0);
  const page = sheet ?? {
    x: 0,
    y: 0,
    width,
    height: height - navigationBar,
    radius: { top: 0, bottom: 0 },
  };
  const dark = theme === "dark";
  const radius = chrome?.duo
    ? duoLayout(chrome.duo, landscape)
        .corners.map((corner) => `${corner}px`)
        .join(" ")
    : (chrome?.radius ?? 3);

  return (
    <div
      className="relative flex-none overflow-hidden bg-background outline outline-foreground/20"
      data-testid="device-frame"
      style={{ width, height, borderRadius: radius }}
    >
      {sheet && (
        <div
          className="absolute inset-0"
          data-testid="presentation-backdrop"
          style={{
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
          left: page.x,
          top: page.y,
          width: page.width,
          height: page.height,
          borderRadius: `${page.radius.top}px ${page.radius.top}px ${page.radius.bottom}px ${page.radius.bottom}px`,
          boxShadow: sheet ? "0 0 40px rgba(0,0,0,0.25)" : undefined,
        }}
      >
        {frames.map((frame) => (
          <HostedIframe
            key={frame.generation}
            hostState={hostState}
            delegate={delegate}
            className={`absolute inset-0 border-0 bg-white transition-opacity duration-hover ${
              frame === visible ? "opacity-100" : "opacity-0"
            }`}
            title={title}
            src={frame.src}
            width={page.width}
            height={page.height}
            onLoad={() => {
              if (!frame.ready) commit(frame.generation);
            }}
          />
        ))}
      </div>
      {navigationBar > 0 && !sheet && (
        <div
          className="absolute inset-x-0 bottom-0"
          data-testid="navigation-bar"
          style={{ height: navigationBar, background: dark ? "#000000" : "#ffffff" }}
        />
      )}
      {chrome && (
        <div className="pointer-events-none absolute inset-0" style={{ width, height }}>
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
