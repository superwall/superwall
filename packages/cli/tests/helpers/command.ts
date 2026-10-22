import { stripVTControlCharacters } from "node:util";
import type { AnyCommand } from "@/program/command";
import { renderCommand } from "@/program/help";
import { resolveLine } from "@/program/parse";
import { listGroups } from "@/commands/registry";
import type { SuperwallApi } from "@/core/api/client";
import { recordingRenderer, type RendererCall } from "./renderer";

export type RunResult = {
  calls: RendererCall[];
  stdout: string;
  json: unknown;
  said(method: string): string[];
};

export type CommandRunOptions = {
  args?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  words?: string[];
  json?: boolean;
  api?: Partial<SuperwallApi>;
  interactive?: boolean;
  renderer?: ReturnType<typeof recordingRenderer>;
};

export async function runCommand(
  command: AnyCommand,
  { args, flags, words, json = false, api, interactive = false, renderer }: CommandRunOptions = {},
): Promise<RunResult> {
  const calls: RendererCall[] = [];
  let stdout = "";
  await command.execute(
    { args, flags, words, json, interactive },
    {
      ...(api === undefined ? {} : { api: () => api as SuperwallApi }),
      nonInteractive: !interactive,
      renderer: () => renderer ?? recordingRenderer(calls),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );
  return resultOf(calls, () => stdout);
}

export async function runLine(
  line: string,
  options: Omit<CommandRunOptions, "args" | "flags" | "words" | "json"> = {},
): Promise<RunResult> {
  const resolution = resolveLine(line.split(" ").filter(Boolean), listGroups());
  if (resolution.kind !== "run") throw new Error(`"${line}" does not run a command (${resolution.kind}).`);
  const { args, flags, words, json } = resolution.input;
  return runCommand(resolution.command, { ...options, args, flags, words, json });
}

export async function helpLine(line: string): Promise<string> {
  const resolution = resolveLine(line.split(" ").filter(Boolean), listGroups());
  if (resolution.kind !== "help") throw new Error(`"${line}" does not show a command's help (${resolution.kind}).`);
  const { command, words } = resolution;
  const page = command.kind === "catalog" ? await command.help(words) : renderCommand(command);
  return stripVTControlCharacters(page);
}

function resultOf(calls: RendererCall[], stdout: () => string): RunResult {
  return {
    calls,
    get stdout() {
      return stdout();
    },
    get json() {
      const text = stdout();
      return text.trim() === "" ? undefined : JSON.parse(text);
    },
    said: (method) =>
      calls
        .filter((call) => call.method === method)
        .map((call) => String(call.value ?? "").replace(/\u001B\[[0-9;]*m/g, "")),
  };
}
