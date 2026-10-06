import * as React from "react";
import { silentDelegate, type HostState } from "@superwall/host";
import { Badge } from "./controls";
import { HostedIframe } from "./preview/HostedIframe";
import { surfacePath } from "../lib/preview";
import { timeAgo } from "../lib/time";
import type { StudioStatus, StudioSurface } from "../lib/surfaces";

const PLATFORM_LABEL: Record<string, string> = { ios: "iOS", android: "Android", web: "Web" };

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

  const meta = [
    surface.label === undefined
      ? surface.project
      : `${surface.project ? `${surface.project}/` : ""}${surface.id}`,
    ...(surface.platforms ?? []).map((platform) => PLATFORM_LABEL[platform] ?? platform),
    status && (status.updatedAt ? `Edited ${timeAgo(status.updatedAt)}` : "Not published"),
  ].filter((part): part is string => Boolean(part));

  return (
    <a
      className="group relative flex min-w-0 flex-col gap-3 border-e border-b border-border p-4 outline-none transition-colors duration-hover before:pointer-events-none before:absolute before:inset-0 before:border before:border-transparent before:transition-colors before:duration-hover hover:bg-foreground/3 focus-visible:before:border-primary"
      href={href ?? surfacePath(surface)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        onOpen();
      }}
    >
      <div
        className="relative aspect-[390/844] overflow-hidden rounded-sm border border-border bg-card"
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
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {surface.label ?? surface.id}
          </span>
          {status?.paywallId && (
            <Badge variant={status.active ? "success" : "outline"}>
              {status.active ? "Active" : "Inactive"}
            </Badge>
          )}
        </span>
        {meta.length > 0 && (
          <span className="truncate text-xs/4 text-fg-tertiary">
            {meta.map((part, index) => (
              <React.Fragment key={index}>
                {index > 0 && (
                  <span className="text-fg-muted" aria-hidden="true">
                    {" · "}
                  </span>
                )}
                {part}
              </React.Fragment>
            ))}
          </span>
        )}
      </div>
    </a>
  );
};
