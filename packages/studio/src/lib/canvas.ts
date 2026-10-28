export type CanvasTransform = { scale: number; x: number; y: number };

export type Size = { width: number; height: number };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
export type Inset = { top: number; right: number; bottom: number; left: number };

export const FIT_INSET: Inset = { top: 48, right: 48, bottom: 48, left: 48 };

const STEP_FACTOR = 1.25;

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const fitTransform = (
  content: Size,
  viewport: Size,
  inset: Inset = FIT_INSET,
): CanvasTransform => {
  if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const room = insetRoom(viewport, inset);
  const scale = clampScale(Math.min(1, room.width / content.width, room.height / content.height));
  return centered(scale, content, viewport, inset);
};

const insetRoom = (viewport: Size, inset: Inset): Size => ({
  width: viewport.width - inset.left - inset.right,
  height: viewport.height - inset.top - inset.bottom,
});

export const centered = (
  scale: number,
  content: Size,
  viewport: Size,
  inset: Inset = FIT_INSET,
): CanvasTransform => {
  const room = insetRoom(viewport, inset);
  return {
    scale,
    x: inset.left + (room.width - content.width * scale) / 2,
    y: inset.top + (room.height - content.height * scale) / 2,
  };
};

export const zoomAt = (
  transform: CanvasTransform,
  factor: number,
  point: { x: number; y: number },
): CanvasTransform => {
  const scale = clampScale(transform.scale * factor);
  const ratio = scale / transform.scale;
  return {
    scale,
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
  };
};

export const panBy = (transform: CanvasTransform, dx: number, dy: number): CanvasTransform => ({
  ...transform,
  x: transform.x + dx,
  y: transform.y + dy,
});

export const stepScale = (scale: number, direction: 1 | -1): number =>
  clampScale(Math.round((direction === 1 ? scale * STEP_FACTOR : scale / STEP_FACTOR) * 100) / 100);

export const percent = (scale: number): string => `${Math.round(scale * 100)}%`;
