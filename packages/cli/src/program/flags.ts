import type { FlagSpec } from "@/program/command";

export const app = {
  type: "string",
  value: "app",
  describe: "The app it's about: an id, a name or a dashboard link",
} as const satisfies FlagSpec;

export const project = {
  type: "string",
  value: "id",
  describe: "Narrow --app to this project",
} as const satisfies FlagSpec;

export const yes = {
  type: "boolean",
  alias: "y",
  describe: "Go ahead without asking",
} as const satisfies FlagSpec;

export const dryRun = {
  type: "boolean",
  describe: "Say what would change; change nothing",
} as const satisfies FlagSpec;

export const data = {
  type: "list",
  value: "key=value",
  describe: "A request field: key=value is text, key:=json is a number, boolean or object, key[sub] nests",
} as const satisfies FlagSpec;

export const installDir = {
  type: "string",
  value: "path",
  describe: "The app's directory (default: the current one)",
} as const satisfies FlagSpec;

export const skill = {
  type: "boolean",
  describe: "Print the agent playbook for this project instead of running",
} as const satisfies FlagSpec;

export const team = {
  type: "string",
  value: "id",
  describe: "The Apple team, when your organization has several",
} as const satisfies FlagSpec;
