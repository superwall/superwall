import * as React from "react";
import { silentDelegate, type HostState } from "@superwall/host";
import { HostedIframe } from "./HostedIframe";
import { surfacePath } from "../lib/preview";
import { timeAgo } from "../lib/time";
import type { StudioStatus, StudioSurface } from "../lib/types";

const PREVIEW_WIDTH = 390;
const PREVIEW_HEIGHT = 844;

const useElementWidth = (ref: React.RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = React.useState(0);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
};

export const SurfaceCard = ({
  surface,
  status,
  previewSrc,
  hostState,
  onOpen,
  href,
}: {
  surface: StudioSurface;
  status?: StudioStatus;
  previewSrc: string;
  hostState: HostState;
  onOpen: () => void;
  href?: string;
}) => {
  const previewRef = React.useRef<HTMLDivElement>(null);
  const width = useElementWidth(previewRef);
  const scale = width > 0 ? width / PREVIEW_WIDTH : 0;
  const delegate = React.useMemo(silentDelegate, []);

  return (
    <a
      className="group block"
      href={href ?? surfacePath(surface)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        onOpen();
      }}
    >
      <div
        className="bg-panel relative aspect-[390/844] overflow-hidden border border-cream/20 transition-colors group-hover:border-cream/35"
        ref={previewRef}
      >
        {scale > 0 && (
          <HostedIframe
            hostState={hostState}
            delegate={delegate}
            className="pointer-events-none block origin-top-left border-0 bg-white"
            title={`${surface.project ? `${surface.project}/` : ""}${surface.id} preview`}
            src={previewSrc}
            loading="lazy"
            tabIndex={-1}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            style={{ transform: `scale(${scale})` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 pt-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            {surface.project && <span className="text-cream/45">{surface.project}/</span>}
            {surface.id}
            {surface.platforms && surface.platforms.length > 0 && (
              <span className="text-cream/45"> · {surface.platforms.join(" · ")}</span>
            )}
          </span>
          {status && (
            <span className="text-xs text-cream/55">
              {status.updatedAt ? `Edited ${timeAgo(status.updatedAt)}` : "Not published"}
            </span>
          )}
        </div>
        {status?.paywallId && (
          <span className={`text-xs ${status.active ? "text-accent" : "text-cream/55"}`}>
            {status.active ? "Active" : "Inactive"}
          </span>
        )}
      </div>
    </a>
  );
};
