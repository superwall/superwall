import yargs from "yargs";
import { onChannel, UsageError, type AnyCommand, type FlagSpec, type RawInput } from "@/program/command";
import type { Group, Topic } from "@/commands/registry";

export type Resolution =
  | { kind: "run"; command: AnyCommand; input: RawInput }
  | { kind: "help"; command: AnyCommand; words: string[] }
  | { kind: "topic"; topic: Topic; group: Group }
  | { kind: "none" };

interface Globals {
  json: boolean;
  interactive: boolean;
  help: boolean;
  rest: string[];
}

function takeGlobals(tokens: readonly string[]): Globals {
  const globals: Globals = { json: false, interactive: true, help: false, rest: [] };
  for (const token of tokens) {
    if (token === "--json") globals.json = true;
    else if (token === "--no-interactive") globals.interactive = false;
    else if (token === "--interactive") globals.interactive = true;
    else if (token === "--help" || token === "-h") globals.help = true;
    else globals.rest.push(token);
  }
  return globals;
}

function leadingWords(tokens: readonly string[]): string[] {
  const words: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("-")) break;
    words.push(token);
  }
  return words;
}

function matches(name: string, words: readonly string[]): number {
  const parts = name.split(" ");
  return parts.every((part, index) => words[index] === part) ? parts.length : 0;
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function parseTokens(
  tokens: readonly string[],
  flags: Readonly<Record<string, FlagSpec>>,
  strict: boolean,
): { positionals: string[]; values: Record<string, unknown> } {
  let parser = yargs([...tokens])
    .help(false)
    .version(false)
    .exitProcess(false)
    .parserConfiguration({
      "parse-numbers": false,
      "parse-positional-numbers": false,
      "camel-case-expansion": true,
      "strip-dashed": true,
      "strip-aliased": true,
    });
  for (const [key, spec] of Object.entries(flags)) {
    parser = parser.option(kebab(key), {
      type: spec.type === "boolean" ? "boolean" : "string",
      ...(spec.alias ? { alias: spec.alias } : {}),
    });
  }
  if (strict) parser = parser.strictOptions();
  const argv = parser
    .fail((message, error) => {
      if (error) throw error;
      const unknown = /^Unknown arguments?: (.*)$/.exec(message);
      if (!unknown?.[1]) throw new UsageError(message);
      const names = unknown[1].split(", ").map((name) => (name.length === 1 ? `-${name}` : `--${name}`));
      throw new UsageError(`Unknown flag: ${names.join(", ")}.`);
    })
    .parseSync();
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(argv)) {
    if (key !== "_" && key !== "$0") values[key] = value;
  }
  return { positionals: argv._.map(String), values };
}

function assignArgs(command: AnyCommand, positionals: string[]): Record<string, unknown> {
  if (command.kind === "catalog") return {};
  const args: Record<string, unknown> = {};
  const remaining = [...positionals];
  for (const [key, spec] of Object.entries(onChannel(command.args))) {
    args[key] = spec.variadic ? remaining.splice(0) : remaining.shift();
  }
  if (remaining.length) {
    throw new UsageError(`\`superwall ${command.name}\` doesn't take "${remaining.join(" ")}".`);
  }
  return args;
}

export function resolveLine(tokens: readonly string[], groups: readonly Group[]): Resolution {
  const globals = takeGlobals(tokens);
  const words = leadingWords(globals.rest);
  let command: AnyCommand | undefined;
  let length = 0;
  for (const candidate of groups.flatMap((group) => group.commands)) {
    const matched = matches(candidate.name, words);
    if (matched > length) {
      command = candidate;
      length = matched;
    }
  }
  let topic: { topic: Topic; group: Group; length: number } | undefined;
  for (const group of groups) {
    for (const candidate of group.topics ?? []) {
      const matched = matches(candidate.name, words);
      if (matched > length && matched > (topic?.length ?? 0)) topic = { topic: candidate, group, length: matched };
    }
  }
  if (topic) {
    const next = words[topic.length];
    if (next === undefined || globals.help) return { kind: "topic", topic: topic.topic, group: topic.group };
    const known = topic.group.commands
      .map((candidate) => candidate.name)
      .filter((name) => name.startsWith(`${topic.topic.name} `))
      .map((name) => name.slice(topic.topic.name.length + 1).split(" ")[0]);
    throw new UsageError(
      `\`superwall ${topic.topic.name}\` has no "${next}". It takes: ${[...new Set(known)].join(", ")}.`,
      topic.topic.name,
    );
  }
  if (!command) return { kind: "none" };
  const rest = globals.rest.slice(length);
  try {
    return resolveCommand(command, rest, globals);
  } catch (error) {
    if (error instanceof UsageError && !error.command) throw new UsageError(error.message, command.name);
    throw error;
  }
}

function resolveCommand(command: AnyCommand, rest: string[], globals: Globals): Resolution {
  const parsed = parseTokens(rest, onChannel(command.flags), command.kind === "command" && !globals.help);
  if (globals.help) return { kind: "help", command, words: parsed.positionals };
  const input = {
    args: assignArgs(command, parsed.positionals),
    words: parsed.positionals,
    flags: parsed.values,
    json: globals.json,
    interactive: globals.interactive,
  };
  if (command.kind === "command") command.validate(input);
  return { kind: "run", command, input };
}

