import pc from "picocolors";
import {
  examplesOf,
  flagName,
  onChannel,
  summaryOf,
  type AnyCommand,
  type ArgSpec,
  type Command,
  type FlagSpec,
} from "@/program/command";
import type { Group, Topic } from "@/commands/registry";
import { VERSION } from "@/environment";
import { cmd, detailLines, exampleLines, renderPage } from "@/ui/help-layout";

const GLOBAL_FLAGS: [string, string][] = [
  ["--app <id|name|link>", "The app a command is about"],
  ["--json", "Machine-readable output"],
  ["--no-interactive", "No prompts, for scripts and CI"],
  ["-v, --version", "Print the version"],
  ["-h, --help", "Help for superwall, or any command"],
];

interface Row {
  name: string;
  summary: string;
  subs?: readonly string[];
}

interface Fold {
  name: string;
  summary: string;
  operations: readonly string[];
  catalog: boolean;
}

function under(name: string, parent: string): boolean {
  return name.startsWith(`${parent} `);
}

function foldsOf(commands: readonly AnyCommand[], topics: readonly Topic[]): Fold[] {
  const folds = [
    ...topics.map((topic) => ({ name: topic.name, summary: topic.summary, operations: [], catalog: false })),
    ...commands.flatMap((command) => {
      if (command.kind !== "catalog") return [];
      return [{ name: command.name, summary: summaryOf(command), operations: command.operations(), catalog: true }];
    }),
  ];
  return folds
    .filter((fold) => fold.catalog || commands.filter((command) => under(command.name, fold.name)).length > 1)
    .sort((a, b) => a.name.length - b.name.length);
}

function subOf(name: string, fold: string, folds: readonly Fold[]): string {
  const [word = ""] = name.slice(fold.length + 1).split(" ");
  return folds.some((candidate) => candidate.name === `${fold} ${word}`) ? `${word} …` : word;
}

function listRows(commands: readonly AnyCommand[], topics: readonly Topic[], parent = ""): Row[] {
  const scoped = parent ? commands.filter((command) => under(command.name, parent)) : commands;
  const folds = foldsOf(scoped, topics.filter((topic) => !parent || under(topic.name, parent)));
  const rows: Row[] = [];
  const folded = new Map<string, Row & { subs: string[] }>();
  for (const command of scoped) {
    const fold = folds.find((candidate) => candidate.name === command.name || under(command.name, candidate.name));
    if (!fold) {
      rows.push({ name: command.name, summary: summaryOf(command) });
      continue;
    }
    let row = folded.get(fold.name);
    if (!row) {
      row = { name: fold.name, summary: fold.summary, subs: [...fold.operations] };
      folded.set(fold.name, row);
      rows.push(row);
    }
    const sub = command.name === fold.name ? undefined : subOf(command.name, fold.name, folds);
    if (sub && !row.subs.includes(sub)) row.subs.push(sub);
  }
  return rows;
}

function packSubs(subs: readonly string[], room: number): string[] {
  const lines: string[] = [];
  for (const sub of subs) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + sub.length + 5 <= room) lines[lines.length - 1] = `${last} · ${sub}`;
    else lines.push(sub);
  }
  return lines.map((line, index) => (index < lines.length - 1 ? `${line} ·` : line));
}

function formatRows(rows: readonly Row[], width: number): string[] {
  const columns = process.stdout.columns || 100;
  const indent = " ".repeat(2 + width);
  return rows.map((row) => {
    const line = `  ${cmd(row.name)}${" ".repeat(Math.max(1, width - row.name.length))}${row.summary}`;
    if (!row.subs?.length) return line;
    const subs = row.subs.join(" · ");
    if (indent.length + row.summary.length + 2 + subs.length <= columns) return `${line}  ${pc.dim(subs)}`;
    return [line, ...packSubs(row.subs, columns - indent.length).map((text) => pc.dim(`${indent}${text}`))].join("\n");
  });
}

export function renderRoot(all: readonly Group[], channelLabel: string): string {
  const groups = all.filter((group) => group.commands.length > 0);
  const rows = groups.map((group) => listRows(group.commands, group.topics ?? []));
  const width = Math.max(...rows.flat().map((row) => row.name.length), ...GLOBAL_FLAGS.map(([flag]) => flag.length)) + 3;
  const out = [
    `${pc.bold("Superwall CLI")} ${pc.dim(`v${VERSION}${channelLabel}`)}`,
    "",
    `${pc.bold("Usage")}  superwall ${cmd("<command>")} ${pc.dim("[subcommand] [flags]")}`,
  ];
  groups.forEach((group, index) => {
    out.push("", pc.bold(group.title), ...formatRows(rows[index] ?? [], width));
    out.push(...(group.notes ?? []).map((note) => pc.dim(`${" ".repeat(2 + width)}${note}`)));
  });
  out.push("", pc.bold("Flags"));
  out.push(...GLOBAL_FLAGS.map(([flag, text]) => `  ${cmd(flag)}${" ".repeat(width - flag.length)}${text}`));
  out.push("", `Run ${pc.bold("superwall <command> --help")} for its flags and examples.`, "");
  return out.join("\n");
}

export function renderTopic(topic: Topic, group: Group): string {
  const rows = listRows(group.commands, group.topics ?? [], topic.name).map((row) => ({
    ...row,
    name: row.name.slice(topic.name.length + 1),
  }));
  const width = Math.max(...rows.map((row) => row.name.length)) + 3;
  const sections = (topic.sections ?? [{ title: "Commands", commands: rows.map((row) => row.name) }]).map((section) => ({
    title: section.title,
    lines: formatRows(
      rows.filter((row) => section.commands.includes(row.name)),
      width,
    ),
  }));
  return renderPage({
    name: topic.name,
    usage: "<command>",
    summary: topic.summary,
    sections: [...sections, { title: "Details", lines: detailLines(topic.details) }],
    footer: `Run ${pc.bold(`superwall ${topic.name} <command> --help`)} for its flags and examples.`,
  });
}

function placeholder(key: string, spec: FlagSpec): string {
  if (spec.type === "boolean") return "";
  if (spec.bare) return ` [<${spec.value ?? "value"}>]`;
  if (spec.choices) return ` <${spec.choices.join("|")}>`;
  if (spec.value) return ` <${spec.value}${spec.type === "list" ? "…" : ""}>`;
  if (spec.type === "number") return " <n>";
  return ` <${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}${spec.type === "list" ? "…" : ""}>`;
}

function formatFlagRows(flags: Readonly<Record<string, FlagSpec>>): [string, string][] {
  return Object.entries(onChannel(flags))
    .filter(([, spec]) => !spec.hidden)
    .map(([key, spec]) => {
      const alias = spec.alias ? `-${spec.alias}, ` : "";
      const fallback =
        spec.default !== undefined && spec.default !== false ? pc.dim(` (default ${String(spec.default)})`) : "";
      return [`${cmd(`${alias}${flagName(key)}`)}${pc.dim(placeholder(key, spec))}`, `${spec.describe}${fallback}`];
    });
}

function argLabel(key: string, spec: ArgSpec): string {
  const name = `${key}${spec.variadic ? "…" : ""}`;
  return spec.required ? `<${name}>` : `[${name}]`;
}

export function usageOf(command: Command): string {
  const args = Object.entries(onChannel(command.args)).map(([key, spec]) => argLabel(key, spec));
  const flags = Object.keys(onChannel(command.flags)).length ? ["[flags]"] : [];
  return [...args, ...flags].join(" ");
}

function commonRows(command: Pick<AnyCommand, "json" | "prompts">): [string, string][] {
  const rows: [string, string][] = [];
  if (command.json) rows.push([cmd("--json"), "Machine-readable output"]);
  if (command.prompts) rows.push([cmd("--no-interactive"), "No prompts, for scripts and CI"]);
  return rows;
}

export function renderCommand(command: Command): string {
  return renderPage({
    name: command.name,
    usage: usageOf(command),
    summary: summaryOf(command),
    sections: [
      {
        title: "Arguments",
        rows: Object.entries(onChannel(command.args)).map(([key, spec]) => [cmd(argLabel(key, spec)), spec.describe]),
      },
      { title: "Flags", rows: formatFlagRows(command.flags) },
      { title: "Common", rows: commonRows(command) },
      { title: "Details", lines: detailLines(command.details) },
      { title: "Examples", lines: exampleLines(examplesOf(command)) },
    ],
  });
}
