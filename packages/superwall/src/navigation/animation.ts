export const TRANSITION_MS = 500;

export const TRANSITION_CAP = 5000;

export const stillness = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const milliseconds = (value: string): number[] =>
  value.split(",").map((one) => {
    const time = Number.parseFloat(one);
    if (!Number.isFinite(time)) return 0;
    return one.includes("ms") ? time : time * 1000;
  });

export const animationMs = (element: Element): number => {
  const style = getComputedStyle(element);
  if (style.animationName === "none" || style.animationName === "") return 0;
  const durations = milliseconds(style.animationDuration);
  const delays = milliseconds(style.animationDelay);
  return style.animationName.split(",").reduce((longest, _name, index) => {
    const total = durations[index % durations.length] + delays[index % delays.length];
    return Math.max(longest, total);
  }, 0);
};

export const longestAnimationMs = (container: HTMLElement | null): number =>
  [...(container?.children ?? [])].reduce(
    (longest, child) => Math.max(longest, animationMs(child)),
    0,
  );

const FROZEN = ["--sw-from-transform", "--sw-from-filter", "--sw-from-opacity"] as const;

const children = (container: HTMLElement | null): HTMLElement[] =>
  [...(container?.children ?? [])].filter((child): child is HTMLElement =>
    Boolean(child instanceof HTMLElement),
  );

export const freeze = (container: HTMLElement | null): void => {
  for (const child of children(container)) {
    if (typeof child.getAnimations !== "function" || child.getAnimations().length === 0) {
      for (const property of FROZEN) child.style.removeProperty(property);
      continue;
    }
    const style = getComputedStyle(child);
    child.style.setProperty("--sw-from-transform", style.transform);
    child.style.setProperty("--sw-from-filter", style.filter);
    child.style.setProperty("--sw-from-opacity", style.opacity);
  }
};

export const thaw = (container: HTMLElement | null): void => {
  for (const child of children(container)) {
    for (const property of FROZEN) child.style.removeProperty(property);
  }
};
