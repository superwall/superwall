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

type Point = { x: number; y: number };

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

const pageClaimsWheel = (event: WheelEvent): boolean => {
  if (event.defaultPrevented) return true;
  const axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "x" : "y";
  for (let node = isElement(event.target) ? event.target : null; node; node = node.parentElement) {
    if (claimsWheel(node, axis)) return true;
  }
  return false;
};

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

  React.useImperativeHandle(ref, () => ({ zoomStep, actualSize, fit }), [
    zoomStep,
    actualSize,
    fit,
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
        zoomWheel(event, toViewport(event.clientX, event.clientY));
        return;
      }
      event.preventDefault();
      apply(panBy(latest.current, -event.deltaX, -event.deltaY));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewport, apply, latest, toViewport, zoomWheel]);

  React.useEffect(() => {
    if (!content) return undefined;
    const attached = new Map<HTMLIFrameElement, () => void>();
    const attach = (frame: HTMLIFrameElement) => {
      attached.get(frame)?.();
      attached.delete(frame);
      const target = sameOriginWindow(frame);
      if (!target) return;
      const onWheel = (event: WheelEvent) => {
        if (isZoomGesture(event)) {
          const rect = frame.getBoundingClientRect();
          const scale = latest.current.scale;
          zoomWheel(
            event,
            toViewport(rect.left + event.clientX * scale, rect.top + event.clientY * scale),
          );
          return;
        }
        if (pageClaimsWheel(event)) return;
        event.preventDefault();
        apply(panBy(latest.current, -event.deltaX, -event.deltaY));
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
          target.addEventListener("click", swallow, { capture: true, once: true });
        }
        press = null;
      };
      target.addEventListener("wheel", onWheel, { passive: false });
      target.addEventListener("pointerdown", onPointerDown);
      target.addEventListener("pointermove", onPointerMove);
      target.addEventListener("pointerup", onPointerUp);
      target.addEventListener("pointercancel", onPointerUp);
      attached.set(frame, () => {
        target.removeEventListener("wheel", onWheel);
        target.removeEventListener("pointerdown", onPointerDown);
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerup", onPointerUp);
        target.removeEventListener("pointercancel", onPointerUp);
      });
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
  }, [content, apply, latest, toViewport, zoomWheel]);

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
