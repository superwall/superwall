import * as React from "react";
import { XIcon } from "../icons";

export const SidePanel = ({
  open,
  title,
  onClose,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
}>) => (
  <aside
    className={`flex-none overflow-hidden transition-[width] duration-move ease-out motion-reduce:transition-none ${
      open ? "w-80" : "w-0"
    }`}
    aria-hidden={!open}
    inert={!open}
  >
    <div className="flex h-full w-80 flex-col border-l border-border bg-background">
      <div className="flex h-12 flex-none items-center justify-between border-b border-border ps-4 pe-2.5">
        <span className="text-sm font-medium">{title}</span>
        <button
          type="button"
          className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <div className="min-h-0 flex-1 scroll-fade overflow-y-auto">{children}</div>
    </div>
  </aside>
);

const STORAGE_KEY = "sw-studio-panel-width";
export const HOST_PANEL_MIN = 320;
export const HOST_PANEL_DEFAULT = 368;
const STAGE_MIN = 400;
const MAX_FRACTION = 0.6;
const KEY_STEP = 16;

/**
 * The widest the host's panel may be in a row `row` px wide: 60% of the row,
 * leaving the stage `STAGE_MIN` plus `reserve` (what else the stage column
 * holds). Never below `HOST_PANEL_MIN`. An unmeasured row (0) has no max.
 */
export const hostPanelMax = (row: number, reserve = 0): number =>
  row > 0
    ? Math.max(HOST_PANEL_MIN, Math.min(row * MAX_FRACTION, row - STAGE_MIN - reserve))
    : Number.POSITIVE_INFINITY;

export const clampHostPanelWidth = (width: number, row: number, reserve = 0): number =>
  Math.round(Math.max(HOST_PANEL_MIN, Math.min(width, hostPanelMax(row, reserve))));

const storedWidth = (): number | undefined => {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
};

const storeWidth = (width: number | undefined) => {
  try {
    if (width === undefined) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    return;
  }
};

/**
 * The host's panel at the start of the editor's row (a chat beside the
 * paywall), from under the top bar to the bottom of the studio; the stage and
 * its toolbar sit to its right. It opens the way the Variables panel does, by
 * growing its width, while its content keeps its own width pinned to the
 * panel's inner edge, so the content slides in from the left and the canvas
 * re-fits beside it; on a row narrower than a phone in landscape it takes the
 * whole row. It has no header: the host draws its own.
 *
 * Its right edge resizes it (pointer, or the arrow keys on the focused edge;
 * Home and End go to the minimum and maximum, a double click back to the
 * default). The width is remembered in localStorage unless the host passes
 * `onWidthChange`, in which case `width` is the host's (undefined: default).
 * `reserve` is what else the stage row holds (the open Variables panel), so
 * the stage keeps its minimum beside it. The row must be a size container.
 */
export const HostPanel = ({
  open,
  label,
  width: hostWidth,
  onWidthChange,
  reserve = 0,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  label: string;
  width?: number;
  onWidthChange?: (width: number | undefined) => void;
  reserve?: number;
}>) => {
  const panel = React.useRef<HTMLElement>(null);
  const [ownWidth, setOwnWidth] = React.useState<number | undefined>(() =>
    onWidthChange ? undefined : storedWidth(),
  );
  const [dragging, setDragging] = React.useState(false);
  const [row, setRow] = React.useState(0);
  const width = onWidthChange ? hostWidth : ownWidth;

  React.useLayoutEffect(() => {
    const element = panel.current?.parentElement;
    if (!element) return undefined;
    const measure = () => setRow(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rowWidth = () => panel.current?.parentElement?.clientWidth ?? 0;

  const change = (next: number | undefined) => {
    if (onWidthChange) onWidthChange(next);
    else {
      setOwnWidth(next);
      storeWidth(next);
    }
  };

  const resize = (next: number) => {
    if (!Number.isFinite(next)) return;
    const measured = rowWidth();
    setRow(measured);
    change(clampHostPanelWidth(next, measured, reserve));
  };

  const current = clampHostPanelWidth(width ?? HOST_PANEL_DEFAULT, row, reserve);
  const max = hostPanelMax(row, reserve);
  const style: React.CSSProperties & Record<"--sw-host-panel", string> = {
    "--sw-host-panel": `clamp(${HOST_PANEL_MIN}px, ${width ?? HOST_PANEL_DEFAULT}px, max(${HOST_PANEL_MIN}px, min(${MAX_FRACTION * 100}cqw, 100cqw - ${STAGE_MIN + reserve}px)))`,
  };

  return (
    <>
      <aside
        ref={panel}
        className={`relative flex-none overflow-hidden @max-xl:w-[100cqw] ${
          dragging
            ? ""
            : "transition-[width] duration-move ease-drawer motion-reduce:transition-none"
        } ${open ? "w-(--sw-host-panel)" : "w-0"}`}
        style={style}
        aria-label={label}
        aria-hidden={!open}
        inert={!open}
        data-testid="host-panel"
      >
        <div className="absolute inset-y-0 end-0 w-(--sw-host-panel) border-r border-border bg-background @max-xl:w-[100cqw]">
          {children}
        </div>
      </aside>
      {open && (
        // Outside the panel: a host may lay its own frame over the panel's box.
        <div className="relative z-20 w-0 flex-none @max-xl:hidden">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${label.toLowerCase()}`}
            aria-valuemin={HOST_PANEL_MIN}
            aria-valuemax={Number.isFinite(max) ? Math.round(max) : undefined}
            aria-valuenow={current}
            tabIndex={0}
            data-dragging={dragging || undefined}
            className="group absolute inset-y-0 -left-px w-2 cursor-col-resize touch-none outline-none"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
            }}
            onPointerMove={(event) => {
              if (!dragging) return;
              resize(event.clientX - (panel.current?.getBoundingClientRect().left ?? 0));
            }}
            onPointerUp={(event) => {
              if (!dragging) return;
              event.currentTarget.releasePointerCapture(event.pointerId);
              setDragging(false);
            }}
            onPointerCancel={() => setDragging(false)}
            onLostPointerCapture={() => setDragging(false)}
            onDoubleClick={() => change(undefined)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") resize(current - KEY_STEP);
              else if (event.key === "ArrowRight") resize(current + KEY_STEP);
              else if (event.key === "Home") resize(HOST_PANEL_MIN);
              else if (event.key === "End") resize(hostPanelMax(rowWidth(), reserve));
              else return;
              event.preventDefault();
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-primary opacity-0 transition-opacity duration-hover group-hover:opacity-100 group-focus-visible:opacity-100 group-data-dragging:opacity-100"
            />
          </div>
          {dragging && <div aria-hidden className="fixed inset-0 z-50 cursor-col-resize" />}
        </div>
      )}
    </>
  );
};
