import { useSyncExternalStore } from "react";
import type { ListItem, Opt } from "../types";

export type { Opt };

export type ItemKind =
  | "intro"
  | "step"
  | "info"
  | "success"
  | "warn"
  | "error"
  | "note"
  | "report"
  | "list"
  | "outro";

export interface TimelineItem {
  id: number;
  kind: ItemKind;
  text: string;
  title?: string;
  list?: { items: ListItem[]; empty?: string };
}

export type Active =
  | { type: "spinner"; message: string }
  | {
      type: "select";
      message: string;
      options: Opt[];
      index: number;
      footer?: string;
      transient?: boolean;
      resolve: (v: string | null) => void;
    }
  | {
      type: "multiselect";
      message: string;
      options: Opt[];
      index: number;
      selected: Set<string>;
      resolve: (v: string[] | null) => void;
    }
  | {
      type: "confirm";
      message: string;
      value: boolean;
      resolve: (v: boolean | null) => void;
    }
  | {
      type: "text";
      message: string;
      placeholder?: string;
      value: string;
      error?: string;
      footer?: string;
      transient?: boolean;
      secret?: boolean;
      validate?: (v: string) => string | undefined;
      resolve: (v: string | null) => void;
    }
  | null;

interface State {
  items: TimelineItem[];
  active: Active;
}

let state: State = { items: [], active: null };
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getState(): State {
  return state;
}

const interruptListeners = new Set<() => void>();

export function onInterrupt(listener: () => void): () => void {
  interruptListeners.add(listener);
  return () => {
    interruptListeners.delete(listener);
  };
}

export function interrupt(): void {
  const active = state.active;
  if (active && active.type !== "spinner") {
    state = {
      ...state,
      items: [...state.items, { id: nextId++, kind: "step", text: `${active.message}\ncancelled` }],
      active: null,
    };
    emit();
    active.resolve(null);
  }
  for (const listener of [...interruptListeners]) listener();
}

export function addItem(kind: ItemKind, text: string, title?: string): void {
  state = {
    ...state,
    items: [...state.items, { id: nextId++, kind, text, title }],
  };
  emit();
}

export function addList(items: ListItem[], empty?: string): void {
  state = {
    ...state,
    items: [...state.items, { id: nextId++, kind: "list", text: "", list: { items, empty } }],
  };
  emit();
}

export function setActive(active: Active): void {
  state = { ...state, active };
  emit();
}

export function updateActive(patch: Partial<NonNullable<Active>>): void {
  if (!state.active) return;
  state = { ...state, active: { ...state.active, ...patch } as Active };
  emit();
}

export function reset(): void {
  state = { items: [], active: null };
  nextId = 1;
  emit();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
