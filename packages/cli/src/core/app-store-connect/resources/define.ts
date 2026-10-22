import { app, dryRun, project, team, yes } from "@/program/flags";
import { defineCatalog, UsageError, type Catalog, type CommandContext, type Example, type FlagSpec } from "@/program/command";
import { renderAscResourceHelp } from "./help";
import type { AscArg, AscFlag, AscOperation, AscOutput } from "./operation";
import { createAscSession, type AscSession } from "./session";
import { printAscOutput, printAscPlan } from "./print";
import { listAscResourceTools } from "./tools";

export interface AscResourceSpec {
  name: string;
  summary: string;
  details?: string;
  operations: readonly AscOperation[];
  examples: readonly Example[];
}

const COMMON_FLAGS = {
  app: { ...app, describe: "A Superwall app of the organization whose App Store Connect key to use: id, name or dashboard link" },
  project,
  team: { ...team, describe: "Apple team id, when your organization has several" },
  yes,
  dryRun: { ...dryRun, describe: "Print every request it would send; send no change" },
} as const satisfies Record<string, FlagSpec>;

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function catalogFlags(operations: readonly AscOperation[]): Record<string, FlagSpec> {
  const flags: Record<string, FlagSpec> = { ...COMMON_FLAGS };
  for (const operation of operations) {
    for (const [key, flag] of Object.entries(operation.flags ?? {})) {
      flags[key] ??= { type: flag.type, describe: flag.describe, ...(flag.value ? { value: flag.value } : {}) };
    }
  }
  return flags;
}

function parseChoice(key: string, flag: AscFlag, text: string): string {
  const choices = flag.choices ?? [];
  const found = choices.find((choice) => choice === text.toUpperCase().replace(/-/g, "_")) ?? choices.find((choice) => choice === text);
  if (choices.length > 0 && !found) throw new UsageError(`--${kebab(key)} takes one of: ${choices.join(", ")} (not "${text}").`);
  return found ?? text;
}

function parseList(raw: unknown): string[] | undefined {
  const items = (Array.isArray(raw) ? raw : [raw]).map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseFlag(key: string, flag: AscFlag, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;
  if (flag.type === "list") return parseList(raw);
  if (flag.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "false") return raw === "true";
    throw new UsageError(`--${kebab(key)} is true or false, not "${String(raw)}".`);
  }
  const text = String(raw).trim();
  if (text === "") return undefined;
  if (flag.type === "number") {
    const number = Number(text);
    if (!Number.isFinite(number)) throw new UsageError(`--${kebab(key)} takes a number, not "${text}".`);
    return number;
  }
  return parseChoice(key, flag, text);
}

function parseArg(command: string, arg: AscArg, word: string | undefined): string | undefined {
  if (word === undefined || !arg.choices) return word;
  const found = arg.choices.find((choice) => choice.toLowerCase() === word.toLowerCase());
  if (!found) throw new UsageError(`${command} takes <${arg.name}> as one of: ${arg.choices.join(", ")} (not "${word}").`);
  return found;
}

function parseInput(command: string, operation: AscOperation, words: string[], raw: Record<string, unknown>) {
  const specs = operation.flags ?? {};
  for (const key of Object.keys(raw)) {
    if (!(key in specs) && !(key in COMMON_FLAGS)) throw new UsageError(`${command} has no --${kebab(key)}. Run superwall ${command} --help for its flags.`);
  }
  const flags = Object.fromEntries(Object.entries(specs).map(([key, flag]) => [key, parseFlag(key, flag, raw[key])]));
  for (const [key, flag] of Object.entries(specs)) {
    if (flag.required && flags[key] === undefined) {
      throw new UsageError(`${command} needs --${kebab(key)}.`);
    }
  }
  const specArgs = operation.args ?? [];
  if (words.length > specArgs.length) throw new UsageError(`${command} doesn't take "${words.slice(specArgs.length).join(" ")}".`);
  const args = Object.fromEntries(specArgs.map((arg, index) => [arg.name, parseArg(command, arg, words[index])]));
  for (const arg of specArgs) {
    if (arg.required && args[arg.name] === undefined) throw new UsageError(`${command} needs <${arg.name}>.`);
  }
  return { args, flags, yes: raw.yes === true };
}

function resolveOperation(spec: AscResourceSpec, words: string[]): [AscOperation, string[]] {
  const [first = "", ...rest] = words;
  const byId = /^\d+$/.test(first);
  const name = byId ? "get" : first;
  const operation = spec.operations.find((candidate) => candidate.name === name);
  if (!operation) {
    const names = spec.operations.map((candidate) => candidate.name).join(", ");
    throw new UsageError(`${spec.name} has no "${name}". It takes: ${names}.\nRun superwall ${spec.name} --help for what each does.`);
  }
  return [operation, byId ? words : rest];
}

async function runAscResource(ctx: CommandContext<"required">, spec: AscResourceSpec, words: string[], raw: Record<string, unknown>): Promise<void> {
  if (words.length === 0) {
    const help = await renderAscResourceHelp(spec, []);
    return ctx.json ? ctx.output.data({ markdown: help }) : ctx.output.text(help);
  }
  const [operation, rest] = resolveOperation(spec, words);
  const input = parseInput(`${spec.name} ${operation.name}`, operation, rest, raw);
  const session: AscSession = await createAscSession(ctx, typeof raw.team === "string" ? raw.team : undefined);
  const output: AscOutput = await operation.run(session, input);
  if (session.dryRun && operation.effect !== "read") return printAscPlan(ctx, session.planned);
  printAscOutput(ctx, output);
}

export function defineAscResource(spec: AscResourceSpec): Catalog {
  const tools = spec.operations.some((operation) => operation.effect !== false);
  return defineCatalog({
    name: spec.name,
    summary: spec.summary,
    details: spec.details,
    flags: catalogFlags(spec.operations),
    operations: () => spec.operations.map((operation) => operation.name),
    help: (words) => renderAscResourceHelp(spec, words),
    tools: async () => listAscResourceTools(spec.operations),
    examples: spec.examples,
    auth: "required",
    json: true,
    prompts: true,
    mcp: tools ? "write" : false,
    run: (ctx, { words, flags }) => runAscResource(ctx, spec, words, flags),
  });
}
