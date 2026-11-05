import * as React from "react";
import {
  centered,
  clampScale,
  FIT_INSET,
  fitTransform,
  panBy,
  stepScale,
  zoomAt,
  type CanvasTransform,
  type Inset,
  type Size,
} from "../../lib/canvas";

const WHEEL_ZOOM_SENSITIVITY = 0.01;
const WHEEL_ZOOM_STEP_LIMIT = { min: 0.6, max: 1.6 };
const DRAG_THRESHOLD = 4;
const GRAB_STYLE_ATTRIBUTE = "data-studio-grab";
const WHEEL_GESTURE_GAP_MS = 120;
const WHEEL_GESTURE_DECIDE_PX = 8;
const WHEEL_PAGE_AXIS_BIAS = 2;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 800;

type Point = { x: number; y: number };

type Axes = { x: boolean; y: boolean };

type WheelGesture = { at: number; sum: Point; pans: Axes | null };

const PANS_NONE: Axes = { x: false, y: false };
const PANS_BOTH: Axes = { x: true, y: true };

type Mode = { kind: "fit" } | { kind: "manual"; transform: CanvasTransform; followsFit: boolean };

type Pinch = { span: number; midpoint: Point };

const CanvasScaleContext = React.createContext(1);

export const useCanvasScale = (): number => React.useContext(CanvasScaleContext);

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const midpointOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const wheelZoomFactor = (deltaY: number): number =>
  Math.min(
    WHEEL_ZOOM_STEP_LIMIT.max,
    Math.max(WHEEL_ZOOM_STEP_LIMIT.min, Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)),
  );

const isZoomGesture = (event: WheelEvent): boolean => event.ctrlKey || event.metaKey;

const swallow = (event: Event) => {
  event.preventDefault();
  event.stopPropagation();
};

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));

const sameOriginWindow = (frame: HTMLIFrameElement): Window | null => {
  try {
    return frame.contentDocument ? frame.contentWindow : null;
  } catch {
    return null;
  }
};

const isElement = (target: EventTarget | null): target is Element =>
  typeof target === "object" && target !== null && (target as Node).nodeType === 1;

type StyleKey = "overflowX" | "overflowY" | "overscrollBehaviorX" | "overscrollBehaviorY";

const styleOf = (element: Element, key: StyleKey): string => {
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element)[key];
  return computed || ("style" in element ? (element as HTMLElement).style[key] : "");
};

const claimsWheel = (element: Element, axis: "x" | "y"): boolean => {
  const overflow = styleOf(element, axis === "y" ? "overflowY" : "overflowX");
  const overscroll = styleOf(element, axis === "y" ? "overscrollBehaviorY" : "overscrollBehaviorX");
  if (/(contain|none)/.test(overscroll)) return true;
  const overflowing =
    (axis === "y"
      ? element.scrollHeight - element.clientHeight
      : element.scrollWidth - element.clientWidth) > 0;
  if (!overflowing) return false;
  return (
    /(auto|scroll|hidden|clip)/.test(overflow) || element === element.ownerDocument.scrollingElement
  );
};

const pageClaimedAxes = (event: WheelEvent): Axes => {
  const claimed = { x: false, y: false };
  for (let node = isElement(event.target) ? event.target : null; node; node = node.parentElement) {
    claimed.x ||= claimsWheel(node, "x");
    claimed.y ||= claimsWheel(node, "y");
  }
  return claimed;
};

const wheelPixels = (event: WheelEvent): Point => {
  const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
};

const ownerOverPage = (sum: Point, claimed: Axes): Axes => {
  const x = Math.abs(sum.x);
  const y = Math.abs(sum.y);
  const pageTakes =
    (claimed.y && y * WHEEL_PAGE_AXIS_BIAS >= x) || (claimed.x && x * WHEEL_PAGE_AXIS_BIAS >= y);
  return pageTakes ? PANS_NONE : { x: !claimed.x, y: !claimed.y };
};

const panDelta = (event: WheelEvent, pans: Axes): Point => ({
  x: pans.x ? -event.deltaX : 0,
  y: pans.y ? -event.deltaY : 0,
});

const useSize = (element: HTMLElement | null): Size => {
  const [size, setSize] = React.useState<Size>({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    if (!element) return undefined;
    const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return size;
};

const useLatest = <T,>(value: T): React.RefObject<T> => {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
};

const useSpaceHeld = (engaged: React.RefObject<boolean>): boolean => {
  const [held, setHeld] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isTyping(event.target)) return;
      if (!engaged.current) return;
      event.preventDefault();
      setHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setHeld(false);
    };
    const release = () => setHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, [engaged]);

  return held;
};

export type CanvasZoom = { scale: number; fitted: boolean };

export type CanvasHandle = {
  zoomStep: (direction: 1 | -1) => void;
  zoomTo: (scale: number) => void;
  zoom: () => CanvasZoom;
  actualSize: () => void;
  fit: () => void;
  hold: () => void;
  pan: (dx: number, dy: number) => void;
};

const insetOf = (inset: number | undefined): Inset =>
  inset === undefined ? FIT_INSET : { top: inset, right: inset, bottom: inset, left: inset };

const sameSize = (a: Size, b: Size): boolean => a.width === b.width && a.height === b.height;

const useEngaged = (viewport: HTMLElement | null, contained: boolean): React.RefObject<boolean> => {
  const engaged = React.useRef(!contained);

  React.useEffect(() => {
    engaged.current = !contained;
    if (!contained || !viewport) return undefined;
    let hovered = false;
    let focused = false;
    const update = () => {
      engaged.current = hovered || focused;
    };
    const controller = new AbortController();
    const { signal } = controller;
    viewport.addEventListener(
      "pointerenter",
      () => {
        hovered = true;
        update();
      },
      { signal },
    );
    viewport.addEventListener(
      "pointerleave",
      () => {
        hovered = false;
        update();
      },
      { signal },
    );
    viewport.addEventListener(
      "focusin",
      () => {
        focused = true;
        update();
      },
      { signal },
    );
    viewport.addEventListener(
      "focusout",
      (event: FocusEvent) => {
        focused = event.relatedTarget instanceof Node && viewport.contains(event.relatedTarget);
        update();
      },
      { signal },
    );
    return () => controller.abort();
  }, [contained, viewport]);

  return engaged;
};

export const Canvas = ({
  fitKey,
  ref,
  onZoom,
  inset,
  contained = false,
  children,
}: React.PropsWithChildren<{
  fitKey: string;
  ref?: React.Ref<CanvasHandle>;
  onZoom?: (zoom: CanvasZoom) => void;
  inset?: number;
  contained?: boolean;
}>) => {
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const [content, setContent] = React.useState<HTMLDivElement | null>(null);
  const [mode, setMode] = React.useState<Mode>({ kind: "fit" });
  const [dragging, setDragging] = React.useState(false);
  const viewportSize = useSize(viewport);
  const contentSize = useSize(content);
  const engaged = useEngaged(viewport, contained);
  const handTool = useSpaceHeld(engaged);
  const room = React.useMemo(() => insetOf(inset), [inset]);

  const transform =
    mode.kind === "fit" ? fitTransform(contentSize, viewportSize, room) : mode.transform;
  const pointers = React.useRef(new Map<number, Point>());
  const pinch = React.useRef<Pinch | null>(null);
  const lastFitKey = React.useRef(fitKey);
  const gesture = React.useRef<WheelGesture | null>(null);
  const requested = React.useRef<Mode>(mode);
  const measured = useLatest({ contentSize, viewportSize, room });

  const current = React.useCallback((): CanvasTransform => {
    const asked = requested.current;
    if (asked.kind === "manual") return asked.transform;
    const sizes = measured.current;
    return fitTransform(sizes.contentSize, sizes.viewportSize, sizes.room);
  }, [measured]);

  const wheelGesture = React.useCallback((): WheelGesture => {
    const now = performance.now();
    const ongoing = gesture.current;
    if (ongoing && now - ongoing.at <= WHEEL_GESTURE_GAP_MS) {
      ongoing.at = now;
      return ongoing;
    }
    gesture.current = { at: now, sum: { x: 0, y: 0 }, pans: null };
    return gesture.current;
  }, []);

  const settle = React.useCallback((transform: CanvasTransform, followsFit: boolean) => {
    requested.current = { kind: "manual", transform, followsFit };
    setMode(requested.current);
  }, []);

  const apply = React.useCallback((next: CanvasTransform) => settle(next, false), [settle]);

  const move = React.useCallback(
    (next: CanvasTransform) => {
      const asked = requested.current;
      settle(next, asked.kind === "fit" || asked.followsFit);
    },
    [settle],
  );

  const fit = React.useCallback(() => {
    requested.current = { kind: "fit" };
    setMode(requested.current);
  }, []);

  const toViewport = React.useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = viewport?.getBoundingClientRect();
      return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
    },
    [viewport],
  );

  const zoomWheel = React.useCallback(
    (event: WheelEvent, at: Point) => {
      event.preventDefault();
      apply(zoomAt(current(), wheelZoomFactor(event.deltaY), at));
    },
    [apply, current],
  );

  const zoomStep = React.useCallback(
    (direction: 1 | -1) => {
      const centre = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
      const from = current();
      apply(zoomAt(from, stepScale(from.scale, direction) / from.scale, centre));
    },
    [apply, current, viewportSize],
  );

  const zoomTo = React.useCallback(
    (scale: number) => {
      const sizes = measured.current;
      apply(centered(clampScale(scale), sizes.contentSize, sizes.viewportSize, sizes.room));
    },
    [apply, measured],
  );

  const zoom = React.useCallback(
    (): CanvasZoom => ({ scale: current().scale, fitted: requested.current.kind === "fit" }),
    [current],
  );

  const actualSize = React.useCallback(() => {
    apply(centered(1, contentSize, viewportSize, room));
  }, [apply, contentSize, viewportSize, room]);

  const hold = React.useCallback(() => move(current()), [move, current]);

  const pan = React.useCallback(
    (dx: number, dy: number) => move(panBy(current(), dx, dy)),
    [move, current],
  );

  React.useImperativeHandle(ref, () => ({ zoomStep, zoomTo, zoom, actualSize, fit, hold, pan }), [
    zoomStep,
    zoomTo,
    zoom,
    actualSize,
    fit,
    hold,
    pan,
  ]);

  React.useEffect(() => {
    onZoom?.({ scale: transform.scale, fitted: mode.kind === "fit" });
  }, [onZoom, transform.scale, mode.kind]);

  const lastViewport = React.useRef(viewportSize);
  React.useLayoutEffect(() => {
    const before = lastViewport.current;
    lastViewport.current = viewportSize;
    if (sameSize(before, viewportSize)) return;
    const asked = requested.current;
    if (asked.kind !== "manual" || before.width <= 0 || before.height <= 0) return;
    const { contentSize: size, room: margin } = measured.current;
    if (asked.followsFit) fit();
    else apply(centered(asked.transform.scale, size, viewportSize, margin));
  }, [viewportSize, measured, fit, apply]);

  React.useEffect(() => {
    if (lastFitKey.current === fitKey) return;
    lastFitKey.current = fitKey;
    fit();
  }, [fitKey, fit]);

  React.useEffect(() => {
    if (!viewport) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (isZoomGesture(event)) {
        gesture.current = null;
        zoomWheel(event, toViewport(event.clientX, event.clientY));
        return;
      }
      if (contained) return;
      const ongoing = wheelGesture();
      ongoing.pans ??= PANS_BOTH;
      if (!ongoing.pans.x && !ongoing.pans.y) return;
      event.preventDefault();
      const delta = panDelta(event, ongoing.pans);
      move(panBy(current(), delta.x, delta.y));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewport, contained, move, current, toViewport, zoomWheel, wheelGesture]);

  React.useEffect(() => {
    if (!content) return undefined;
    const attached = new Map<HTMLIFrameElement, () => void>();
    const attach = (frame: HTMLIFrameElement) => {
      attached.get(frame)?.();
      attached.delete(frame);
      const target = sameOriginWindow(frame);
      if (!target) return;
      const controller = new AbortController();
      const { signal } = controller;
      const onWheel = (event: WheelEvent) => {
        if (isZoomGesture(event)) {
          gesture.current = null;
          const rect = frame.getBoundingClientRect();
          const scale = current().scale;
          zoomWheel(
            event,
            toViewport(rect.left + event.clientX * scale, rect.top + event.clientY * scale),
          );
          return;
        }
        if (contained) return;
        const ongoing = wheelGesture();
        if (event.defaultPrevented) return;
        if (!ongoing.pans) {
          const pixels = wheelPixels(event);
          ongoing.sum = { x: ongoing.sum.x + pixels.x, y: ongoing.sum.y + pixels.y };
          if (Math.hypot(ongoing.sum.x, ongoing.sum.y) < WHEEL_GESTURE_DECIDE_PX) return;
          ongoing.pans = ownerOverPage(ongoing.sum, pageClaimedAxes(event));
        }
        if (!ongoing.pans.x && !ongoing.pans.y) return;
        event.preventDefault();
        const delta = panDelta(event, ongoing.pans);
        move(panBy(current(), delta.x, delta.y));
      };
      let press: { at: Point; panning: boolean } | null = null;
      let grabStyle: HTMLStyleElement | null = null;
      const grab = (on: boolean) => {
        const doc = frame.contentDocument;
        if (!doc) return;
        grabStyle?.remove();
        grabStyle = null;
        if (!on) return;
        grabStyle = doc.createElement("style");
        grabStyle.setAttribute(GRAB_STYLE_ATTRIBUTE, "");
        grabStyle.textContent = "*, *::before, *::after { cursor: grabbing !important; }";
        (doc.head ?? doc.documentElement).appendChild(grabStyle);
      };
      const onPointerDown = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || event.button !== 1) return;
        event.preventDefault();
        press = { at: { x: event.screenX, y: event.screenY }, panning: false };
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!press) return;
        const point = { x: event.screenX, y: event.screenY };
        if (!press.panning) {
          if (distance(press.at, point) < DRAG_THRESHOLD) return;
          press.panning = true;
          setDragging(true);
          grab(true);
        }
        event.preventDefault();
        move(panBy(current(), point.x - press.at.x, point.y - press.at.y));
        press.at = point;
      };
      const onPointerUp = () => {
        if (press?.panning) {
          setDragging(false);
          grab(false);
          target.addEventListener("click", swallow, { capture: true, once: true, signal });
        }
        press = null;
      };
      target.addEventListener("wheel", onWheel, { passive: false, signal });
      target.addEventListener("pointerdown", onPointerDown, { signal });
      target.addEventListener("pointermove", onPointerMove, { signal });
      target.addEventListener("pointerup", onPointerUp, { signal });
      target.addEventListener("pointercancel", onPointerUp, { signal });
      attached.set(frame, () => controller.abort());
    };
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement) attach(event.target);
    };
    content.querySelectorAll("iframe").forEach(attach);
    content.addEventListener("load", onLoad, true);
    return () => {
      content.removeEventListener("load", onLoad, true);
      attached.forEach((detach) => detach());
    };
  }, [content, contained, move, current, toViewport, zoomWheel, wheelGesture]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isTyping(event.target) || !engaged.current) return;
      if (event.key === "=" || event.key === "+") zoomStep(1);
      else if (event.key === "-") zoomStep(-1);
      else if (event.key === "0") fit();
      else if (event.key === "1") actualSize();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomStep, fit, actualSize, engaged]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { span: distance(a, b), midpoint: midpointOf(a, b) };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const next: Pinch = { span: distance(a, b), midpoint: midpointOf(a, b) };
      const zoomed = zoomAt(
        current(),
        next.span / pinch.current.span,
        toViewport(pinch.current.midpoint.x, pinch.current.midpoint.y),
      );
      apply(
        panBy(
          zoomed,
          next.midpoint.x - pinch.current.midpoint.x,
          next.midpoint.y - pinch.current.midpoint.y,
        ),
      );
      pinch.current = next;
      return;
    }

    const asked = requested.current;
    const fitted = asked.kind === "fit" || asked.followsFit;
    if (contained && event.pointerType !== "mouse" && fitted) return;
    move(panBy(current(), point.x - previous.x, point.y - previous.y));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  const cursor = dragging ? "cursor-grabbing" : handTool ? "cursor-grab" : "";
  const framesInert = handTool || dragging ? "[&_iframe]:pointer-events-none" : "";
  const touch = !contained
    ? "touch-none"
    : mode.kind === "fit" || mode.followsFit
      ? "touch-pan-y"
      : "touch-none pointer-coarse:[&_iframe]:pointer-events-none";

  return (
    <div
      className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${touch} select-none ${cursor} ${framesInert}`}
      data-testid="canvas"
      data-contained={contained || undefined}
      data-panning={handTool || undefined}
      data-dragging={dragging || undefined}
      ref={setViewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => {
        if (dragging) event.preventDefault();
      }}
    >
      <div
        className="absolute top-0 left-0 flex origin-top-left items-start gap-16"
        data-testid="canvas-content"
        ref={setContent}
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        <CanvasScaleContext.Provider value={transform.scale}>
          {children}
        </CanvasScaleContext.Provider>
      </div>
    </div>
  );
};
