import * as React from "react";
import {
  centered,
  fitTransform,
  panBy,
  stepScale,
  zoomAt,
  type CanvasTransform,
  type Size,
} from "../../lib/canvas";

const WHEEL_ZOOM_SENSITIVITY = 0.01;
const WHEEL_ZOOM_STEP_LIMIT = { min: 0.6, max: 1.6 };
const DRAG_THRESHOLD = 4;
const GRAB_STYLE_ATTRIBUTE = "data-studio-grab";
const WHEEL_GESTURE_GAP_MS = 120;
const WHEEL_GESTURE_DECIDE_PX = 4;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 800;

type Point = { x: number; y: number };

type Axes = { x: boolean; y: boolean };

type WheelGesture = { at: number; sum: Point; pans: Axes | null };

const PANS_NONE: Axes = { x: false, y: false };
const PANS_BOTH: Axes = { x: true, y: true };

type Mode = { kind: "fit" } | { kind: "manual"; transform: CanvasTransform };

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
  const axis = Math.abs(sum.x) > Math.abs(sum.y) ? "x" : "y";
  return claimed[axis] ? PANS_NONE : { x: !claimed.x, y: !claimed.y };
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

const useSpaceHeld = (): boolean => {
  const [held, setHeld] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isTyping(event.target)) return;
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
  }, []);

  return held;
};

export type CanvasZoom = { scale: number; fitted: boolean };

export type CanvasHandle = {
  zoomStep: (direction: 1 | -1) => void;
  actualSize: () => void;
  fit: () => void;
  hold: () => void;
  pan: (dx: number, dy: number) => void;
};

export const Canvas = ({
  fitKey,
  ref,
  onZoom,
  children,
}: React.PropsWithChildren<{
  fitKey: string;
  ref?: React.Ref<CanvasHandle>;
  onZoom?: (zoom: CanvasZoom) => void;
}>) => {
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const [content, setContent] = React.useState<HTMLDivElement | null>(null);
  const [mode, setMode] = React.useState<Mode>({ kind: "fit" });
  const [dragging, setDragging] = React.useState(false);
  const viewportSize = useSize(viewport);
  const contentSize = useSize(content);
  const handTool = useSpaceHeld();

  const transform = mode.kind === "fit" ? fitTransform(contentSize, viewportSize) : mode.transform;
  const latest = useLatest(transform);
  const pointers = React.useRef(new Map<number, Point>());
  const pinch = React.useRef<Pinch | null>(null);
  const lastFitKey = React.useRef(fitKey);
  const gesture = React.useRef<WheelGesture | null>(null);

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

  const apply = React.useCallback((next: CanvasTransform) => {
    setMode({ kind: "manual", transform: next });
  }, []);

  const fit = React.useCallback(() => setMode({ kind: "fit" }), []);

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
      apply(zoomAt(latest.current, wheelZoomFactor(event.deltaY), at));
    },
    [apply, latest],
  );

  const zoomStep = React.useCallback(
    (direction: 1 | -1) => {
      const centre = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
      const next = stepScale(latest.current.scale, direction);
      apply(zoomAt(latest.current, next / latest.current.scale, centre));
    },
    [apply, latest, viewportSize],
  );

  const actualSize = React.useCallback(() => {
    apply(centered(1, contentSize, viewportSize));
  }, [apply, contentSize, viewportSize]);

  const hold = React.useCallback(() => apply(latest.current), [apply, latest]);

  const pan = React.useCallback(
    (dx: number, dy: number) => apply(panBy(latest.current, dx, dy)),
    [apply, latest],
  );

  React.useImperativeHandle(ref, () => ({ zoomStep, actualSize, fit, hold, pan }), [
    zoomStep,
    actualSize,
    fit,
    hold,
    pan,
  ]);

  React.useEffect(() => {
    onZoom?.({ scale: transform.scale, fitted: mode.kind === "fit" });
  }, [onZoom, transform.scale, mode.kind]);

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
      const current = wheelGesture();
      current.pans ??= PANS_BOTH;
      if (!current.pans.x && !current.pans.y) return;
      event.preventDefault();
      const delta = panDelta(event, current.pans);
      apply(panBy(latest.current, delta.x, delta.y));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewport, apply, latest, toViewport, zoomWheel, wheelGesture]);

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
          const scale = latest.current.scale;
          zoomWheel(
            event,
            toViewport(rect.left + event.clientX * scale, rect.top + event.clientY * scale),
          );
          return;
        }
        const current = wheelGesture();
        if (event.defaultPrevented) return;
        if (!current.pans) {
          const pixels = wheelPixels(event);
          current.sum = { x: current.sum.x + pixels.x, y: current.sum.y + pixels.y };
          if (Math.hypot(current.sum.x, current.sum.y) < WHEEL_GESTURE_DECIDE_PX) return;
          current.pans = ownerOverPage(current.sum, pageClaimedAxes(event));
        }
        if (!current.pans.x && !current.pans.y) return;
        event.preventDefault();
        const delta = panDelta(event, current.pans);
        apply(panBy(latest.current, delta.x, delta.y));
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
        apply(panBy(latest.current, point.x - press.at.x, point.y - press.at.y));
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
  }, [content, apply, latest, toViewport, zoomWheel, wheelGesture]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isTyping(event.target)) return;
      if (event.key === "=" || event.key === "+") zoomStep(1);
      else if (event.key === "-") zoomStep(-1);
      else if (event.key === "0") fit();
      else if (event.key === "1") actualSize();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomStep, fit, actualSize]);

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
        latest.current,
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

    apply(panBy(latest.current, point.x - previous.x, point.y - previous.y));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  const cursor = dragging ? "cursor-grabbing" : handTool ? "cursor-grab" : "";
  const framesInert = handTool || dragging ? "[&_iframe]:pointer-events-none" : "";

  return (
    <div
      className={`relative min-h-0 min-w-0 flex-1 overflow-hidden touch-none select-none ${cursor} ${framesInert}`}
      data-testid="canvas"
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
