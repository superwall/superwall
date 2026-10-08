import { render, type Instance } from "ink";
import { App } from "./App";
import { addItem, addList, onInterrupt, reset, setActive, updateActive } from "./store";
import type { MultiSelectOpts, Renderer, SelectOpts, Spinner, TextOpts } from "../types";

let instance: Instance | null = null;

function start(): void {
  if (!instance) {
    reset();
    instance = render(<App />, { exitOnCtrlC: false });
  }
}

function stop(): void {
  if (instance) {
    instance.unmount();
    instance = null;
  }
}

export const inkRenderer: Renderer = {
  start,
  stop,
  intro: (text: string) => addItem("intro", text),
  step: (text: string) => addItem("step", text),
  info: (text: string) => addItem("info", text),
  success: (text: string) => addItem("success", text),
  warn: (text: string) => addItem("warn", text),
  error: (text: string) => addItem("error", text),
  note: (text: string, title?: string) => addItem("note", text, title),
  report: (text: string) => addItem("report", text),
  list: (o) => addList(o.items, o.empty),
  outro: (text: string) => {
    if (text) addItem("outro", text);
  },
  onInterrupt,

  spinner(): Spinner {
    return {
      start: (message: string) => setActive({ type: "spinner", message }),
      message: (message: string) => updateActive({ message }),
      stop: (message: string) => {
        setActive(null);
        addItem("step", message);
      },
    };
  },

  select(o: SelectOpts): Promise<string | null> {
    const preferred = o.options.findIndex((x) => x.value === o.initialValue && !x.disabled);
    const index =
      preferred >= 0
        ? preferred
        : Math.max(
            0,
            o.options.findIndex((x) => !x.disabled),
          );
    return new Promise((resolve) =>
      setActive({
        type: "select",
        message: o.message,
        options: o.options,
        index,
        footer: o.footer,
        transient: o.transient,
        resolve,
      }),
    );
  },

  multiselect(o: MultiSelectOpts): Promise<string[] | null> {
    return new Promise((resolve) =>
      setActive({
        type: "multiselect",
        message: o.message,
        options: o.options,
        index: 0,
        selected: new Set(o.initialValues ?? []),
        resolve,
      }),
    );
  },

  confirm(o: { message: string; initial?: boolean }): Promise<boolean | null> {
    return new Promise((resolve) =>
      setActive({
        type: "confirm",
        message: o.message,
        value: o.initial ?? true,
        resolve,
      }),
    );
  },

  text(o: TextOpts): Promise<string | null> {
    return new Promise((resolve) =>
      setActive({
        type: "text",
        message: o.message,
        placeholder: o.placeholder,
        value: o.initialValue ?? "",
        footer: o.footer,
        transient: o.transient,
        secret: o.secret,
        validate: o.validate,
        resolve,
      }),
    );
  },
};
