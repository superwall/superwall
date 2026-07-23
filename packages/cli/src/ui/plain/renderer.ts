import type { MultiSelectOpts, Renderer, SelectOpts, Spinner, TextOpts } from "../types";
import { stripVTControlCharacters } from "node:util";
import { styleMarkdown } from "../log";

function out(line: string): void {
  process.stdout.write(`${plainText(line)}\n`);
}

function err(line: string): void {
  process.stderr.write(`${plainText(line)}\n`);
}

function plainText(value: string): string {
  return stripVTControlCharacters(styleMarkdown(value));
}

export const plainRenderer: Renderer = {
  start: () => {},
  stop: () => {},
  intro: out,
  step: out,
  info: out,
  success: out,
  warn: out,
  error: err,
  note: (text, title) => {
    if (title) out(title);
    out(text);
  },
  report: out,
  list: ({ items, empty }) => {
    if (items.length === 0) return out(empty ?? "None.");
    for (const item of items) {
      out([item.label, item.badge, item.meta].filter(Boolean).join("  "));
      for (const child of item.children ?? []) {
        out(`  ${[child.label, child.badge, child.meta].filter(Boolean).join("  ")}`);
      }
    }
  },
  outro: (text) => {
    if (text) out(text);
  },
  spinner(): Spinner {
    return { start: () => {}, message: () => {}, stop: () => {} };
  },
  async select(_opts: SelectOpts) {
    return null;
  },
  async multiselect(_opts: MultiSelectOpts) {
    return null;
  },
  async confirm() {
    return null;
  },
  async text(_opts: TextOpts) {
    return null;
  },
};
