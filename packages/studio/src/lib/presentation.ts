export type StudioPresentation = {
  style: "fullscreen" | "modal" | "push" | "noAnimation" | "drawer" | "popup";
  width?: number;
  height?: number;
  cornerRadius?: number;
};

export type PresentationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: { top: number; bottom: number };
  underlay: boolean;
};

const DEFAULT_RADIUS = 15;
const DRAWER_DEFAULT_HEIGHT = 70;
const POPUP_DEFAULT = { width: 80, height: 60 };
const TABLET_MIN_WIDTH = 600;

export const modalHeightPercent = (width: number, height: number): number => {
  const offset = 0.1 * (width / height) + 0.035;
  return Math.round((100 - offset * 100) * 10) / 10;
};

export const presentationRect = (
  presentation: StudioPresentation | undefined,
  frame: { width: number; height: number },
): PresentationRect | undefined => {
  if (!presentation) return undefined;
  const radius = presentation.cornerRadius ?? DEFAULT_RADIUS;
  const tablet = Math.min(frame.width, frame.height) >= TABLET_MIN_WIDTH;
  const centered = (widthPercent: number, heightPercent: number): PresentationRect => {
    const width = Math.round((frame.width * widthPercent) / 100);
    const height = Math.round((frame.height * heightPercent) / 100);
    return {
      x: Math.round((frame.width - width) / 2),
      y: Math.round((frame.height - height) / 2),
      width,
      height,
      radius: { top: radius, bottom: radius },
      underlay: false,
    };
  };
  const bottom = (heightPercent: number, underlay: boolean): PresentationRect => {
    const height = Math.round((frame.height * heightPercent) / 100);
    return {
      x: 0,
      y: frame.height - height,
      width: frame.width,
      height,
      radius: { top: radius, bottom: 0 },
      underlay,
    };
  };

  switch (presentation.style) {
    case "modal":
      return tablet ? centered(70, 80) : bottom(modalHeightPercent(frame.width, frame.height), true);
    case "drawer":
      return bottom(presentation.height ?? DRAWER_DEFAULT_HEIGHT, false);
    case "popup":
      return centered(
        presentation.width ?? POPUP_DEFAULT.width,
        presentation.height ?? POPUP_DEFAULT.height,
      );
    default:
      return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const STYLES: Record<string, StudioPresentation["style"]> = {
  FULLSCREEN: "fullscreen",
  MODAL: "modal",
  PUSH: "push",
  NO_ANIMATION: "noAnimation",
  DRAWER: "drawer",
  POPUP: "popup",
};

export const parsePresentation = (value: unknown): StudioPresentation | undefined => {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  const style = STYLES[value.type];
  if (!style) return undefined;
  return {
    style,
    ...(number(value.width) === undefined ? {} : { width: number(value.width) }),
    ...(number(value.height) === undefined ? {} : { height: number(value.height) }),
    ...(number(value.corner_radius) === undefined
      ? {}
      : { cornerRadius: number(value.corner_radius) }),
  };
};
