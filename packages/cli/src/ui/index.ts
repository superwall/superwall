import type { Renderer } from "./types";

let active: Renderer | undefined;

export function useRenderer(renderer: Renderer): Renderer {
  active = renderer;
  return renderer;
}

export const silentRenderer: Renderer = {
  start: () => {},
  stop: () => {},
  intro: () => {},
  step: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  note: () => {},
  report: () => {},
  list: () => {},
  outro: () => {},
  spinner: () => ({ start: () => {}, message: () => {}, stop: () => {} }),
  select: async () => null,
  multiselect: async () => null,
  confirm: async () => null,
  text: async () => null,
};

const current = (): Renderer => active ?? silentRenderer;

export const ui: Renderer = {
  start: () => current().start(),
  stop: () => current().stop(),
  intro: (t) => current().intro(t),
  step: (t) => current().step(t),
  info: (t) => current().info(t),
  success: (t) => current().success(t),
  warn: (t) => current().warn(t),
  error: (t) => current().error(t),
  note: (t, title) => current().note(t, title),
  report: (t) => current().report(t),
  list: (o) => current().list(o),
  outro: (t) => current().outro(t),
  spinner: () => current().spinner(),
  select: (o) => current().select(o),
  multiselect: (o) => current().multiselect(o),
  confirm: (o) => current().confirm(o),
  text: (o) => current().text(o),
  onInterrupt: (listener) => current().onInterrupt?.(listener) ?? (() => {}),
};

export type { Renderer, Opt, SelectOpts } from "./types";
