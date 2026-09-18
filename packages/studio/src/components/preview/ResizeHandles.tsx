import * as React from "react";

export type FrameSize = { width: number; height: number };

type Horizontal = "left" | "right";
type Vertical = "top" | "bottom";
type Handle = {
  id: string;
  label: string;
  x?: Horizontal;
  y?: Vertical;
  className: string;
  cursor: string;
};

const HANDLES: readonly Handle[] = [
  {
    id: "top",
    label: "Resize height from the top",
    y: "top",
    className: "-top-2 left-0 h-4 w-full",
    cursor: "ns-resize",
  },
  {
    id: "bottom",
    label: "Resize height",
    y: "bottom",
    className: "-bottom-2 left-0 h-4 w-full",
    cursor: "ns-resize",
  },
  {
    id: "left",
    label: "Resize width from the left",
    x: "left",
    className: "top-0 -left-2 h-full w-4",
    cursor: "ew-resize",
  },
  {
    id: "right",
    label: "Resize width",
    x: "right",
    className: "top-0 -right-2 h-full w-4",
    cursor: "ew-resize",
  },
  {
    id: "top-left",
    label: "Resize from the top left",
    x: "left",
    y: "top",
    className: "-top-2 -left-2 h-5 w-5",
    cursor: "nwse-resize",
  },
  {
    id: "top-right",
    label: "Resize from the top right",
    x: "right",
    y: "top",
    className: "-top-2 -right-2 h-5 w-5",
    cursor: "nesw-resize",
  },
  {
    id: "bottom-left",
    label: "Resize from the bottom left",
    x: "left",
    y: "bottom",
    className: "-bottom-2 -left-2 h-5 w-5",
    cursor: "nesw-resize",
  },
  {
    id: "bottom-right",
    label: "Resize",
    x: "right",
    y: "bottom",
    className: "-right-2 -bottom-2 h-5 w-5",
    cursor: "nwse-resize",
  },
];

type Drag = {
  pointerId: number;
  handle: Handle;
  from: { x: number; y: number };
  start: FrameSize;
  last: FrameSize;
  release: () => void;
};

export const ResizeHandles = ({
  size,
  scale,
  clamp,
  onResize,
  onDragStart,
  onShift,
}: {
  size: FrameSize;
  scale: number;
  clamp: (value: number, fallback: number) => number;
  onResize: (next: FrameSize) => void;
  onDragStart?: () => void;
  onShift?: (dx: number, dy: number) => void;
}) => {
  const drag = React.useRef<Drag | null>(null);

  const end = React.useCallback(() => {
    drag.current?.release();
    drag.current = null;
  }, []);

  React.useEffect(() => end, [end]);

  const onPointerDown = (handle: Handle) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const element = event.currentTarget;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    end();
    const pointerId = event.pointerId;
    const released = (release: PointerEvent) => {
      if (release.pointerId === pointerId) end();
    };
    const finish = () => end();
    window.addEventListener("pointerup", released);
    window.addEventListener("pointercancel", released);
    window.addEventListener("blur", finish);
    element.addEventListener("lostpointercapture", finish);
    drag.current = {
      pointerId,
      handle,
      from: { x: event.clientX, y: event.clientY },
      start: size,
      last: size,
      release: () => {
        window.removeEventListener("pointerup", released);
        window.removeEventListener("pointercancel", released);
        window.removeEventListener("blur", finish);
        element.removeEventListener("lostpointercapture", finish);
      },
    };
    onDragStart?.();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.pointerType === "mouse" && event.buttons === 0) {
      end();
      return;
    }
    const { handle, start } = current;
    const dx = (event.clientX - current.from.x) / scale;
    const dy = (event.clientY - current.from.y) / scale;
    const next: FrameSize = {
      width:
        handle.x === "right"
          ? clamp(Math.round(start.width + dx), start.width)
          : handle.x === "left"
            ? clamp(Math.round(start.width - dx), start.width)
            : start.width,
      height:
        handle.y === "bottom"
          ? clamp(Math.round(start.height + dy), start.height)
          : handle.y === "top"
            ? clamp(Math.round(start.height - dy), start.height)
            : start.height,
    };
    const shiftX = handle.x === "left" ? -(next.width - current.last.width) * scale : 0;
    const shiftY = handle.y === "top" ? -(next.height - current.last.height) * scale : 0;
    current.last = next;
    onResize(next);
    if (shiftX !== 0 || shiftY !== 0) onShift?.(shiftX, shiftY);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    end();
  };

  return (
    <>
      {HANDLES.map((handle) => (
        <div
          key={handle.id}
          role="separator"
          aria-label={handle.label}
          aria-orientation={handle.y && !handle.x ? "horizontal" : "vertical"}
          data-testid={`resize-${handle.id}`}
          className={`absolute z-10 touch-none select-none ${handle.className}`}
          style={{ cursor: handle.cursor }}
          onPointerDown={onPointerDown(handle)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ))}
    </>
  );
};
