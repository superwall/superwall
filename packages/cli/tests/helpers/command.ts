import { executeCommand, type AuthPolicy, type CommandDefinition } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import { recordingRenderer, type RendererCall } from "./renderer";

export type RunResult = {
  calls: RendererCall[];
  stdout: string;
  json: unknown;
  said(method: string): string[];
};

export type RunOptions = {
  argv?: Record<string, unknown>;
  api?: Partial<SuperwallApi>;
  interactive?: boolean;
  renderer?: ReturnType<typeof recordingRenderer>;
};

export async function run<Auth extends AuthPolicy>(
  definition: CommandDefinition<Auth>,
  { argv = {}, api, interactive = false, renderer }: RunOptions = {},
): Promise<RunResult> {
  const calls: RendererCall[] = [];
  let stdout = "";

  await executeCommand(
    definition,
    { _: [], $0: "superwall", ...argv },
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

  return {
    calls,
    stdout,
    get json() {
      return stdout.trim() === "" ? undefined : JSON.parse(stdout);
    },
    said: (method) =>
      calls.filter((call) => call.method === method).map((call) => String(call.value ?? "")),
  };
}
