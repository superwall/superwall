import { stripAnsi } from "./ansi";
import pc from "picocolors";
import { fg, THEME } from "@/ui/theme";

export const visible = (text: string) => stripAnsi(text).length;
export const cmd = (text: string) => fg(THEME.primary, text);
export const head = (text: string) => pc.bold(text);

export function table(rows: [string, string][], plain: (row: [string, string]) => number): string[] {
  const width = Math.max(0, ...rows.map(plain)) + 3;
  return rows.map(([left, right]) => `  ${left}${" ".repeat(width - plain([left, right]))}${right}`);
}

export function wrap(text: string, indent: number): string {
  const columns = Math.max(60, process.stdout.columns || 100);
  const room = columns - indent;
  if (text.length <= room) return text;
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > room) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.join(`\n${" ".repeat(indent)}`);
}

function flagTable(rows: [string, string][]): string[] {
  const width = Math.min(40, Math.max(...rows.map(([left]) => visible(left))) + 3);
  return rows.flatMap(([left, right]) => {
    const text = wrap(right, width + 2);
    if (visible(left) + 1 > width) return [`  ${left}`, `  ${" ".repeat(width)}${text}`];
    return [`  ${left}${" ".repeat(width - visible(left))}${text}`];
  });
}

interface PageSection {
  title: string;
  rows?: [string, string][];
  lines?: string[];
}

export interface Page {
  name: string;
  usage?: string;
  summary: string;
  note?: string;
  sections: PageSection[];
  footer?: string;
}

export function detailLines(text: string | undefined): string[] {
  if (!text) return [];
  return text.split("\n").map((line) => (line ? `  ${line}` : line));
}

export function exampleLines(examples: readonly (readonly [string, string, ...unknown[]])[]): string[] {
  if (examples.some(([example]) => example.length > 64)) {
    return examples.flatMap(([example, text], index) => [
      ...(index ? [""] : []),
      `  ${pc.dim(`# ${text}`)}`,
      `  ${pc.dim("$")} superwall ${example}`,
    ]);
  }
  return table(
    examples.map(([example, text]) => [`${pc.dim("$")} superwall ${example}`, pc.dim(text)]),
    ([left]) => visible(left),
  );
}

export function renderPage(page: Page): string {
  const out = [`${head(`superwall ${page.name}`)}${page.usage ? ` ${pc.dim(page.usage)}` : ""}`, wrap(page.summary, 0)];
  if (page.note) out.push("", pc.dim(wrap(page.note, 0)));
  for (const section of page.sections) {
    const lines = section.lines ?? flagTable(section.rows ?? []);
    if (lines.length) out.push("", head(section.title), ...lines);
  }
  if (page.footer) out.push("", page.footer);
  out.push("");
  return out.join("\n");
}
