import { listGroups } from "@/commands/registry";
import { createSuperwallApi, type SuperwallApi } from "@/core/api/client";
import { emptyStore, memoryStore, useStores, type Store } from "@/core/state/store";
import { VERSION } from "@/environment";
import {
  onChannel,
  summaryOf,
  type AnyCommand,
  type ArgSpec,
  type Catalog,
  type CatalogTool,
  type Command,
  type FlagSpec,
  type JsonSchema,
  type RawInput,
  type ToolEffect,
} from "@/program/command";
import { useHost, type Host } from "@/program/host";
import { silentRenderer } from "@/ui";

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolResult {
  ok: boolean;
  data: unknown;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, JsonSchema>; required: string[]; additionalProperties: false };
  annotations: ToolAnnotations;
  run: (input: Record<string, unknown>, api: SuperwallApi) => Promise<ToolResult>;
  cli: (input: Record<string, unknown>) => string[];
}

const UNSENT_FLAGS = new Set(["yes", "installDir", "skill", "dryRun", "interactive"]);

const mcpHost: Host = {
  api: () => {
    throw new Error("Each tool call brings its own API client.");
  },
  renderer: () => silentRenderer,
  stdout: { write: () => true },
  nonInteractive: true,
  installDir: () => "/",
  readInput: () => {
    throw new Error("Files and stdin aren't available here: pass the value itself.");
  },
  detectApp: async () => ({}),
  readLockRef: () => undefined,
  track: () => {},
  starting: () => {},
  finishing: () => {},
  fail: () => {},
  waitForPaint: false,
};

let cacheStore: Store | undefined;

export function apiFor({ token, host }: { token: string; host: string }): SuperwallApi {
  return createSuperwallApi({ apiKey: token, host, createdAt: new Date().toISOString() });
}

export function useToolCache(store: Store): void {
  cacheStore = store;
}

const SEED: Record<string, string> = JSON.parse(process.env.SUPERWALL_TOOLS_SEED ?? "{}");
const SKILLS: Record<string, string> = JSON.parse(process.env.SUPERWALL_TOOLS_SKILLS ?? "{}");

export interface SkillFile {
  uri: string;
  name: string;
  description: string;
  text: string;
}

const skillDescription = (path: string, text: string): string => {
  const front = /^---\n[\s\S]*?^description:\s*(.+)$/m.exec(text)?.[1];
  if (front) return front.trim();
  return /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? path;
};

const MAIN_SKILL = "superwall/SKILL.md";
const skillRank = (path: string): number => (path === MAIN_SKILL ? 0 : path.endsWith("/SKILL.md") ? 1 : 2);

export function listSkills(): SkillFile[] {
  return Object.entries(SKILLS)
    .sort(([a], [b]) => skillRank(a) - skillRank(b) || a.localeCompare(b))
    .map(([path, text]) => ({ uri: `skill://${path}`, name: path, description: skillDescription(path, text), text }));
}

export function readSkill(uri: string): SkillFile | undefined {
  return listSkills().find((file) => file.uri === uri);
}

function skillTool(): Tool {
  const files = listSkills();
  const paths = files.map((file) => file.name);
  return {
    name: "skill",
    title: "Read the Superwall skill",
    description: [
      "Superwall's skills: guides for agents. superwall/SKILL.md says how the account, SDK, campaigns, analytics and App Store Connect fit together; read it before other work, then the reference, workflow or other skill it points to.",
      "Building paywalls as code, integrating the SDK and migrating need the Superwall CLI on the user's machine; the guide says so where it applies.",
    ].join("\n\n"),
    inputSchema: {
      type: "object",
      properties: { file: { type: "string", enum: paths, description: `Which file to read (default: ${MAIN_SKILL})` } },
      required: [],
      additionalProperties: false,
    },
    annotations: { title: "Read the Superwall skill", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (input) => {
      const name = typeof input.file === "string" ? input.file : MAIN_SKILL;
      const file = files.find((entry) => entry.name === name);
      if (!file) return { ok: false, data: { error: { code: "not_found", message: `No skill file ${String(input.file)}.` } } };
      return { ok: true, data: { file: file.name, text: file.text } };
    },
    cli: () => ["skills"],
  };
}

function install(): void {
  cacheStore ??= memoryStore();
  for (const [name, text] of Object.entries(SEED)) {
    if (cacheStore.read(name) === undefined) cacheStore.write(name, text);
  }
  useStores({ cache: cacheStore, state: emptyStore });
  useHost(mcpHost);
}

const nameOf = (words: readonly string[]) => words.join("_").replace(/-/g, "_");
const ACRONYMS = new Set(["api", "asa", "asc", "get", "post", "put", "patch", "delete"]);
const titleOf = (words: readonly string[]) => {
  const [first = "", ...rest] = words.map((word) => word.replace(/-/g, " "));
  const lead = ACRONYMS.has(first) ? first.toUpperCase() : first.charAt(0).toUpperCase() + first.slice(1);
  return [lead, ...rest].join(" ");
};
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

function schemaOfArg(spec: ArgSpec): JsonSchema {
  const item: JsonSchema = spec.choices ? { type: "string", enum: spec.choices } : { type: "string" };
  return spec.variadic ? { type: "array", items: item, description: spec.describe } : { ...item, description: spec.describe };
}

function schemaOfFlag(spec: FlagSpec): JsonSchema {
  if (spec.type === "list") return { type: "array", items: { type: "string" }, description: spec.describe };
  const base: JsonSchema = { type: spec.type, description: spec.describe };
  return spec.choices ? { ...base, enum: spec.choices } : base;
}

const OUTSIDE_SUPERWALL = new Set(["asc", "asa", "events retry", "webhooks create", "webhooks update"]);

function annotationsOf(words: readonly string[], effect: Exclude<ToolEffect, false>): ToolAnnotations {
  return {
    title: titleOf(words),
    readOnlyHint: effect === "read",
    destructiveHint: effect === "destructive",
    idempotentHint: effect === "read",
    openWorldHint: OUTSIDE_SUPERWALL.has(words[0] ?? "") || OUTSIDE_SUPERWALL.has(words.slice(0, 2).join(" ")),
  };
}

function describe(summary: string, details: string | undefined, cli: string): string {
  return [summary, details, `The CLI equivalent is \`superwall ${cli}\`.`].filter(Boolean).join("\n\n");
}

async function execute(command: AnyCommand, raw: RawInput, api: SuperwallApi): Promise<ToolResult> {
  install();
  let output = "";
  let failed = false;
  await command.execute(
    { ...raw, json: true, interactive: false },
    {
      api: () => api,
      stdout: { write: (chunk) => ((output += String(chunk)), true) },
      fail: () => {
        failed = true;
      },
    },
  );
  const text = output.trim();
  const data: unknown = text === "" ? null : JSON.parse(text);
  return { ok: !failed, data };
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const isJson = (schema: JsonSchema | undefined) => {
  const types = Array.isArray(schema?.type) ? schema.type : [schema?.type];
  return types.includes("object") || (types.includes("array") && schema?.items?.type !== "string");
};

function flagArgv(key: string, value: unknown, schema?: JsonSchema): string[] {
  const flag = key.length === 1 ? `-${key}` : `--${kebab(key)}`;
  if (value === undefined || value === null) return [];
  if (value === true) return [flag];
  if (value === false) return key.length === 1 ? [] : [`--no-${kebab(key)}`];
  if (isJson(schema)) return [flag, typeof value === "string" ? value : JSON.stringify(value)];
  if (Array.isArray(value)) return value.flatMap((item) => flagArgv(key, item));
  return [flag, typeof value === "object" ? JSON.stringify(value) : String(value)];
}

function commandTool(command: Command): Tool {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(onChannel(command.args))) {
    if (spec.mcp === false) continue;
    properties[snake(key)] = schemaOfArg(spec);
    if (spec.required || spec.mcp === "required") required.push(snake(key));
  }
  for (const [key, spec] of Object.entries(onChannel(command.flags))) {
    if (spec.hidden || spec.mcp === false || UNSENT_FLAGS.has(key)) continue;
    properties[snake(key)] = schemaOfFlag(spec);
    if (spec.mcp === "required") required.push(snake(key));
  }
  const argKeys = new Set(Object.keys(command.args));
  return {
    name: nameOf(command.name.split(" ")),
    title: titleOf(command.name.split(" ")),
    description: describe(summaryOf(command), command.details, command.name),
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: annotationsOf(command.name.split(" "), command.mcp || "write"),
    run: (input, api) => {
      const args: Record<string, unknown> = {};
      const flags: Record<string, unknown> = { yes: true };
      for (const [name, value] of Object.entries(input)) {
        const key = camel(name);
        (argKeys.has(key) ? args : flags)[key] = value;
      }
      return execute(command, { args, flags }, api);
    },
    cli: (input) => {
      const positional = Object.keys(command.args).flatMap((key) => {
        const value = input[snake(key)];
        return value === undefined ? [] : Array.isArray(value) ? value.map(String) : [String(value)];
      });
      const flags = Object.entries(input)
        .filter(([name]) => !argKeys.has(camel(name)))
        .flatMap(([name, value]) => flagArgv(camel(name), value, properties[name]));
      return [...command.name.split(" "), ...positional, ...flags, ...(command.flags.yes ? ["--yes"] : [])];
    },
  };
}

function catalogTool(catalog: Catalog, tool: CatalogTool): Tool {
  const words = [...catalog.name.split(" "), ...tool.words];
  return {
    name: nameOf(words),
    title: titleOf(words),
    description: describe(tool.summary, tool.details, words.join(" ")),
    inputSchema: { type: "object", properties: tool.input.properties, required: tool.input.required, additionalProperties: false },
    annotations: annotationsOf(words, tool.effect || "write"),
    run: (input, api) => {
      const values = tool.positionals.map((name) => input[name]);
      const flags: Record<string, unknown> = { yes: true };
      for (const [name, value] of Object.entries(input)) {
        if (!tool.positionals.includes(name)) flags[camel(name)] = value;
      }
      const positional = values.filter((value) => value !== undefined).map(String);
      return execute(catalog, { words: [...tool.words, ...positional], flags }, api);
    },
    cli: (input) => {
      const positional = tool.positionals.flatMap((name) => (input[name] === undefined ? [] : [String(input[name])]));
      const flags = Object.entries(input)
        .filter(([name]) => !tool.positionals.includes(name))
        .flatMap(([name, value]) => flagArgv(camel(name), value, tool.input.properties[name]));
      return [...words, ...positional, ...flags, ...(catalog.flags.yes ? ["--yes"] : [])];
    },
  };
}

function toolCommands(): AnyCommand[] {
  return listGroups().flatMap((group) => group.commands);
}

export async function listTools(): Promise<Tool[]> {
  install();
  const tools: Tool[] = [];
  for (const command of toolCommands()) {
    if (command.mcp === false) continue;
    if (command.kind === "command") {
      tools.push(commandTool(command));
      continue;
    }
    for (const tool of await command.tools()) {
      if (tool.effect !== false) tools.push(catalogTool(command, tool));
    }
  }
  if (Object.keys(SKILLS).length > 0) tools.unshift(skillTool());
  return tools;
}

export function instructions(): string {
  const guide = Object.keys(SKILLS).length > 0;
  return [
    `These tools are the Superwall CLI (${VERSION}) as an MCP: each tool is one of its commands, takes the same inputs, and answers with that command's --json output. They manage a Superwall account: apps, products, entitlements, campaigns, paywalls, users, webhooks, analytics, App Store Connect and Apple Search Ads.`,
    "",
    "If you can run shell commands, use the CLI itself instead: `npx superwall@latest login`, then `npx superwall@latest skills` to install Superwall's skills for you. It does everything these tools do, plus the work that needs the user's machine and has no tool here: installing and integrating the SDK in their app, migrating from RevenueCat, Adapty or Qonversion, reviewing a setup, and signing in to Apple to create keys. Without a shell, use these tools, and when that kind of work comes up, give the user the `npx superwall` command to run in their terminal.",
    "",
    ...(guide
      ? [
          "Read the skill tool first. It returns Superwall's guide for agents: how the pieces fit together and how to approach each kind of task, including the multi-step App Store Connect and Apple Search Ads work.",
          "",
        ]
      : []),
    "Choosing a tool:",
    "- bootstrap shows everything the user can reach in one call. Wherever a tool takes app, pass the app's id, name or dashboard link.",
    "- Analytics: query runs ClickHouse SQL over every event, transaction and user; use it for any question about revenue, conversion, retention or behaviour. apps_statistics, campaigns_counts and campaigns_audiences_readout return the dashboard's own figures.",
    "- App Store Connect: asc_ tools. Apple Search Ads: asa_ tools. Both reach Apple through Superwall with the keys already connected to the app; the user needs no Apple credentials of their own.",
    "- An endpoint with no tool of its own: api_docs finds it, then get, post, patch or delete calls it.",
    "- Destructive tools can delete, archive, replace existing configuration or publish changes to live users. Confirm with the user before calling one.",
  ].join("\n");
}

export function callResult(result: ToolResult): {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
} {
  const text = JSON.stringify(result.data, null, 2);
  const structured = result.data !== null && typeof result.data === "object" && !Array.isArray(result.data);
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: result.data as Record<string, unknown> } : {}),
    isError: !result.ok,
  };
}
