import * as React from "react";
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
  onOpen,
}: {
  surface: StudioSurface;
  status?: StudioStatus;
  previewSrc: string;
  onOpen: () => void;
}) => {
  const previewRef = React.useRef<HTMLDivElement>(null);
  const width = useElementWidth(previewRef);
  const scale = width > 0 ? width / PREVIEW_WIDTH : 0;

  return (
    <a
      className="group block"
      href={`/${surface.kind}/${surface.id}`}
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
          <iframe
            className="pointer-events-none block origin-top-left border-0 bg-white"
            title={`${surface.id} preview`}
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
          <span className="text-sm font-medium">{surface.id}</span>
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
