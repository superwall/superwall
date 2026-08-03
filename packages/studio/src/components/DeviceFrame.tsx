import * as React from "react";
import { DeviceChrome } from "./DeviceChrome";
import type { DeviceChromeSpec } from "../lib/devices";

const FRAME_MARGIN = 96;

const SWAP_DELAY_MS = 250;

type PreviewWindow = Window & { __swPreviewApply?: (search: string) => void };

const useFitScale = (
  container: React.RefObject<HTMLElement | null>,
  width: number,
  height: number,
): number => {
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const element = container.current;
    if (!element) return undefined;

    const fit = () => {
      const available = element.getBoundingClientRect();
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
    observer.observe(element);
    return () => observer.disconnect();
  }, [container, width, height]);

  return scale;
};

export const DevicePlaceholder = ({
  width,
  height,
  stageRef,
  children,
}: React.PropsWithChildren<{
  width: number;
  height: number;
  stageRef: React.RefObject<HTMLElement | null>;
}>) => {
  const scale = useFitScale(stageRef, width, height);

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
  mountSrc: string;
  currentSrc: string;
  generation: number;
  ready: boolean;
};

const instantApply = (node: HTMLIFrameElement | undefined, from: string, to: string): boolean => {
  try {
    const base = window.location.origin;
    const fromUrl = new URL(from, base);
    const toUrl = new URL(to, base);
    if (fromUrl.origin !== toUrl.origin || fromUrl.pathname !== toUrl.pathname) return false;
    const apply = (node?.contentWindow as PreviewWindow | null | undefined)?.__swPreviewApply;
    if (typeof apply !== "function") return false;
    apply(toUrl.search);
    return true;
  } catch {
    return false;
  }
};

export const DeviceFrame = ({
  width,
  height,
  title,
  src,
  stageRef,
  reloadKey = 0,
  chrome,
  landscape = false,
  theme = "light",
}: {
  width: number;
  height: number;
  title: string;
  src: string;
  stageRef: React.RefObject<HTMLElement | null>;
  reloadKey?: number;
  chrome?: DeviceChromeSpec;
  landscape?: boolean;
  theme?: "light" | "dark";
}) => {
  const scale = useFitScale(stageRef, width, height);

  const generation = React.useRef(0);
  const [frames, setFrames] = React.useState<Frame[]>([
    { mountSrc: src, currentSrc: src, generation: 0, ready: true },
  ]);
  const framesRef = React.useRef(frames);
  framesRef.current = frames;
  const nodes = React.useRef(new Map<number, HTMLIFrameElement>());

  const mounted = React.useRef(false);
  const lastReload = React.useRef(reloadKey);
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const forced = reloadKey !== lastReload.current;
    lastReload.current = reloadKey;

    if (!forced) {
      const visible = framesRef.current.findLast((frame) => frame.ready);
      const node = visible ? nodes.current.get(visible.generation) : undefined;
      if (visible && instantApply(node, visible.currentSrc, src)) {
        setFrames((existing) =>
          existing.map((frame) =>
            frame.generation === visible.generation ? { ...frame, currentSrc: src } : frame,
          ),
        );
        return;
      }
    }

    generation.current += 1;
    const next: Frame = {
      mountSrc: src,
      currentSrc: src,
      generation: generation.current,
      ready: false,
    };
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

  return (
    <div
      className={`bg-panel relative flex-none overflow-hidden ${
        chrome ? "shadow-[0_0_0_1px] shadow-cream/25" : "border border-cream/20"
      }`}
      data-testid="device-frame"
      style={{ width: width * scale, height: height * scale, borderRadius: radius }}
    >
      {frames.map((frame) => (
        <iframe
          key={frame.generation}
          ref={(node) => {
            if (node) nodes.current.set(frame.generation, node);
            else nodes.current.delete(frame.generation);
          }}
          className={`absolute inset-0 origin-top-left border-0 bg-white transition-opacity duration-150 ${
            frame === visible ? "opacity-100" : "opacity-0"
          }`}
          title={title}
          src={frame.mountSrc}
          width={width}
          height={height}
          style={{ transform: `scale(${scale})` }}
          onLoad={() => {
            if (!frame.ready) commit(frame.generation);
          }}
        />
      ))}
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
