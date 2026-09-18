import type { OutputMode } from "@/output";
import { inkRenderer } from "./ink/runtime";
import { plainRenderer } from "./plain/renderer";
import type { Renderer } from "./types";

let active: Renderer = plainRenderer;

export function selectRenderer(opts: { mode: OutputMode }): Renderer {
  const { mode } = opts;
  active = mode === "rich" ? inkRenderer : mode === "json" ? silentRenderer : plainRenderer;
  return active;
}

export function useRenderer(renderer: Renderer): Renderer {
  active = renderer;
  return renderer;
}

const silentRenderer: Renderer = {
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

export const ui: Renderer = {
  start: () => active.start(),
  stop: () => active.stop(),
  intro: (t) => active.intro(t),
  step: (t) => active.step(t),
  info: (t) => active.info(t),
  success: (t) => active.success(t),
  warn: (t) => active.warn(t),
  error: (t) => active.error(t),
  note: (t, title) => active.note(t, title),
  report: (t) => active.report(t),
  list: (o) => active.list(o),
  outro: (t) => active.outro(t),
  spinner: () => active.spinner(),
  select: (o) => active.select(o),
  multiselect: (o) => active.multiselect(o),
  confirm: (o) => active.confirm(o),
  text: (o) => active.text(o),
  onInterrupt: (listener) => active.onInterrupt?.(listener) ?? (() => {}),
};

export type {
  Renderer,
  Opt,
  SelectOpts,
  MultiSelectOpts,
  TextOpts,
  Spinner,
  ListItem,
  ListOpts,
} from "./types";
