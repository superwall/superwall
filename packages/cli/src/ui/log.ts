import { pathToFileURL } from "node:url";
import { link as ansiLink } from "ansi-escapes";
import pc from "picocolors";
import wrapAnsi from "wrap-ansi";
import { THEME, fg } from "./theme";

function brand(text: string): string {
  return fg(THEME.primary, text);
}

export function stripReport(raw: string): string {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/^\s*\[STATUS\]/i.test(l));
  while (lines[0]?.trim() === "") lines.shift();
  while (lines.at(-1)?.trim() === "") lines.pop();
  return lines.join("\n");
}

export function styleMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => styleMarkdownLine(line))
    .join("\n");
}

export function styleMarkdownLine(line: string, opts: { hyperlinks?: boolean } = {}): string {
  const heading = line.match(/^\s*(#{1,6})\s+(.*)$/)?.[2];
  if (heading !== undefined) return brand(pc.bold(styleInline(heading, opts.hyperlinks ?? false)));
  return styleInline(line, opts.hyperlinks ?? false);
}

export function wrapReportLine(line: string, columns: number): string[] {
  const bullet = line.match(/^(\s*(?:(?:[-*+])|(?:\d+[.)]))\s+)/);
  const prefix = bullet?.[1] ?? "";
  const content = prefix ? line.slice(prefix.length) : line;
  const width = Math.max(12, columns - prefix.length);
  const wrapped = wrapAnsi(styleMarkdownLine(content, { hyperlinks: true }), width, {
    hard: true,
    trim: false,
  }).split("\n");
  return wrapped.map((part, index) => `${index === 0 ? prefix : " ".repeat(prefix.length)}${part}`);
}

function styleInline(line: string, hyperlinks: boolean): string {
  const re = /\[([^\]]+)]\(([^)]+)\)|\*\*(.+?)\*\*|`([^`]+)`|(https?:\/\/[^\s]+)/g;
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    out += line.slice(last, match.index);
    if (match[1] != null && match[2] != null) {
      const label = match[1];
      const target = match[2];
      out += hyperlinks
        ? ansiLink(brand(pc.underline(label)), terminalLinkTarget(target))
        : `${label} (${target})`;
    } else if (match[3] != null) {
      out += pc.bold(match[3]);
    } else if (match[4] != null) {
      out += brand(match[4]);
    } else if (match[5] != null) {
      out += hyperlinks ? ansiLink(brand(pc.underline(match[5])), match[5]) : match[5];
    }
    last = re.lastIndex;
  }
  out += line.slice(last);
  return out;
}

function terminalLinkTarget(target: string): string {
  const local = target.match(/^(\/.*?)(?::(\d+))?$/);
  const file = local?.[1];
  if (file === undefined) return target;
  const url = pathToFileURL(file).href;
  return local?.[2] ? `${url}#L${local[2]}` : url;
}
