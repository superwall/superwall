import { CHANNEL, type CHANNELS } from "@/environment";
import type { SuperwallApi } from "@/core/api/client";
import type { CommandOutput, OutputMode } from "@/program/output";
import type { Renderer } from "@/ui/types";
import type { Host } from "./host";
import { runLifecycle } from "./lifecycle";

export type AuthPolicy = "none" | "optional" | "required";
export type ToolEffect = "read" | "write" | "destructive" | false;
export type Channel = keyof typeof CHANNELS;
export type Example = readonly [command: string, describe: string, channel?: Channel];

export interface FlagSpec {
  type: "string" | "number" | "boolean" | "list";
  describe: string;
  alias?: string;
  choices?: readonly string[];
  default?: string | number | boolean;
  value?: string;
  bare?: boolean;
  verbatim?: boolean;
  hidden?: boolean;
  channel?: Channel;
  mcp?: "required" | false;
}

export interface ArgSpec {
  describe: string;
  required?: boolean;
  variadic?: boolean;
  choices?: readonly string[];
  channel?: Channel;
  mcp?: "required" | false;
}

type FlagValue<F extends FlagSpec> = F["type"] extends "boolean"
  ? boolean
  : F["type"] extends "list"
    ? string[]
    : F["type"] extends "number"
      ? F extends { default: number }
        ? number
        : number | undefined
      : F extends { default: string }
        ? string
        : string | undefined;

type ArgValue<A extends ArgSpec> = A extends { variadic: true }
  ? string[]
  : A extends { required: true }
    ? string
    : string | undefined;

type FlagValues<F extends Record<string, FlagSpec>> = { [K in keyof F]: FlagValue<F[K]> };
type ArgValues<A extends Record<string, ArgSpec>> = { [K in keyof A]: ArgValue<A[K]> };

interface Target {
  app?: string;
  project?: string;
}

interface BaseContext {
  ui: Renderer;
  output: CommandOutput;
  outputMode: OutputMode;
  interactive: boolean;
  installDir: string;
  json: boolean;
  dryRun: boolean;
  target: Target;
  fail: () => void;
}

export type CommandContext<Auth extends AuthPolicy = AuthPolicy> = BaseContext &
  (Auth extends "required" ? { api: SuperwallApi } : { api?: SuperwallApi });

interface Description<Auth extends AuthPolicy> {
  name: string;
  summary: string;
  summaryOn?: Partial<Record<Channel, string>>;
  details?: string;
  examples: readonly Example[];
  auth: Auth;
  json: boolean;
  prompts: boolean;
  mcp: ToolEffect;
  channel?: Channel;
}

interface CommandSpec<
  Auth extends AuthPolicy,
  A extends Record<string, ArgSpec>,
  F extends Record<string, FlagSpec>,
> extends Description<Auth> {
  args?: A;
  flags?: F;
  run: (ctx: CommandContext<Auth>, input: { args: ArgValues<A>; flags: FlagValues<F> }) => void | Promise<void>;
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: readonly unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
}

export interface CatalogTool {
  words: string[];
  summary: string;
  details?: string;
  positionals: string[];
  input: { properties: Record<string, JsonSchema>; required: string[] };
  effect: ToolEffect;
}

interface CatalogSpec<Auth extends AuthPolicy> extends Description<Auth> {
  flags?: Readonly<Record<string, FlagSpec>>;
  operations: () => readonly string[];
  help: (words: readonly string[]) => Promise<string>;
  tools: () => Promise<CatalogTool[]>;
  run: (ctx: CommandContext<Auth>, input: { words: string[]; flags: Record<string, unknown> }) => void | Promise<void>;
}

export interface RawInput {
  args?: Record<string, unknown>;
  words?: string[];
  flags?: Record<string, unknown>;
  json?: boolean;
  interactive?: boolean;
}

export type CommandRuntime = Partial<Host>;

interface Common {
  name: string;
  summary: string;
  summaryOn?: Partial<Record<Channel, string>>;
  details?: string;
  examples: readonly Example[];
  auth: AuthPolicy;
  json: boolean;
  prompts: boolean;
  mcp: ToolEffect;
  channel?: Channel;
  execute: (input: RawInput, runtime?: CommandRuntime) => Promise<void>;
}

export interface Command extends Common {
  kind: "command";
  validate: (input: RawInput) => void;
  args: Readonly<Record<string, ArgSpec>>;
  flags: Readonly<Record<string, FlagSpec>>;
}

export interface Catalog extends Common {
  kind: "catalog";
  flags: Readonly<Record<string, FlagSpec>>;
  operations: () => readonly string[];
  tools: () => Promise<CatalogTool[]>;
  help: (words: readonly string[]) => Promise<string>;
}

export type AnyCommand = Command | Catalog;

export function onChannel<S extends { channel?: Channel }>(specs: Readonly<Record<string, S>>): Record<string, S> {
  return Object.fromEntries(Object.entries(specs).filter(([, spec]) => spec.channel === undefined || spec.channel === CHANNEL()));
}

export function summaryOf(command: Pick<Common, "summary" | "summaryOn">): string {
  return command.summaryOn?.[CHANNEL()] ?? command.summary;
}

export function examplesOf(command: Pick<Common, "examples">): Example[] {
  return command.examples.filter(([, , channel]) => channel === undefined || channel === CHANNEL());
}

export class UsageError extends Error {
  constructor(
    message: string,
    readonly command?: string,
  ) {
    super(message);
  }
}

export function flagName(key: string): string {
  const kebab = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return kebab.length === 1 ? `-${kebab}` : `--${kebab}`;
}

function readFlag(key: string, spec: FlagSpec, raw: unknown): unknown {
  const value = raw ?? spec.default;
  if (spec.type === "boolean") return value === true;
  if (spec.type === "list") {
    if (value === undefined || value === null) return [];
    return (Array.isArray(value) ? value : [value]).map(String);
  }
  if (value === "" && spec.bare) return "";
  if (value === undefined || value === null || value === "") return undefined;
  if (spec.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new UsageError(`${flagName(key)} takes a number, not "${String(value)}".`);
    return number;
  }
  const text = spec.verbatim ? String(value) : String(value).trim();
  if (text.trim() === "") return undefined;
  if (spec.choices && !spec.choices.includes(text)) {
    throw new UsageError(`${flagName(key)} takes one of: ${spec.choices.join(", ")} (not "${text}").`);
  }
  return text;
}

function readArg(key: string, spec: ArgSpec, raw: unknown): unknown {
  if (spec.variadic) {
    const values = raw === undefined || raw === null ? [] : (Array.isArray(raw) ? raw : [raw]).map(String);
    if (spec.required && values.length === 0) throw new UsageError(`Missing <${key}>.`);
    return values;
  }
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  if (text === "") {
    if (spec.required) throw new UsageError(`Missing <${key}>.`);
    return undefined;
  }
  if (spec.choices && !spec.choices.includes(text)) {
    throw new UsageError(`<${key}> is one of: ${spec.choices.join(", ")} (not "${text}").`);
  }
  return text;
}

function readValues<S>(specs: Readonly<Record<string, S>>, raw: Record<string, unknown>, read: (key: string, spec: S, value: unknown) => unknown) {
  return Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, read(key, spec, raw[key])]));
}


export function defineCommand<
  Auth extends AuthPolicy,
  A extends Record<string, ArgSpec> = Record<never, ArgSpec>,
  F extends Record<string, FlagSpec> = Record<never, FlagSpec>,
>(spec: CommandSpec<Auth, A, F>): Command {
  const args: Record<string, ArgSpec> = spec.args ?? {};
  const flags: Record<string, FlagSpec> = spec.flags ?? {};
  const read = (input: RawInput) => {
    const values = {
      args: readValues(onChannel(args), input.args ?? {}, readArg),
      flags: readValues(onChannel(flags), input.flags ?? {}, readFlag),
    };
    return values as { args: ArgValues<A>; flags: FlagValues<F> };
  };
  return {
    kind: "command",
    name: spec.name,
    summary: spec.summary,
    summaryOn: spec.summaryOn,
    details: spec.details,
    examples: spec.examples,
    auth: spec.auth,
    json: spec.json,
    prompts: spec.prompts,
    mcp: spec.mcp,
    channel: spec.channel,
    args,
    flags,
    validate: (input) => {
      read(input);
    },
    execute: (input, runtime = {}) => {
      return runLifecycle<Auth>(spec, input, runtime, (ctx) => spec.run(ctx, read(input)));
    },
  };
}

export function defineCatalog<Auth extends AuthPolicy>(spec: CatalogSpec<Auth>): Catalog {
  return {
    kind: "catalog",
    name: spec.name,
    summary: spec.summary,
    summaryOn: spec.summaryOn,
    details: spec.details,
    examples: spec.examples,
    auth: spec.auth,
    json: spec.json,
    prompts: spec.prompts,
    mcp: spec.mcp,
    channel: spec.channel,
    flags: spec.flags ?? {},
    operations: spec.operations,
    help: spec.help,
    tools: spec.tools,
    execute: (input, runtime = {}) => {
      return runLifecycle<Auth>(spec, input, runtime, (ctx) => {
        return spec.run(ctx, { words: input.words ?? [], flags: input.flags ?? {} });
      });
    },
  };
}
