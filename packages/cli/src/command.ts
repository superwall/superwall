import { resolve } from "node:path";
import pc from "picocolors";
import type { Arguments } from "yargs";
import { ApiError, superwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import { NotLoggedInError } from "@/core/auth/errors";
import { createCommandOutput, type CommandOutput, type OutputMode, writeJson } from "@/output";
import { maybeShowTelemetryNotice, track } from "@/core/telemetry";
import { maybeNotifyUpdate, refreshUpdateCheck } from "@/core/update";
import { selectRenderer, useRenderer } from "@/ui";
import type { Renderer } from "@/ui/types";
import { isNonInteractive } from "@/environment";

export type AuthPolicy = "none" | "optional" | "required";
export type InteractionPolicy = "allowed" | "none";
export type OutputPolicy = "human" | "json" | "both";

interface BaseCommandContext {
  argv: Arguments;
  ui: Renderer;
  output: CommandOutput;
  outputMode: OutputMode;
  interactive: boolean;
  installDir: string;
  json: boolean;
  dryRun: boolean;
}

export type CommandContext<Auth extends AuthPolicy = AuthPolicy> = BaseCommandContext &
  (Auth extends "required" ? { api: SuperwallApi } : { api?: SuperwallApi });

export interface CommandDefinition<Auth extends AuthPolicy = "none"> {
  name: string;
  auth?: Auth;
  interaction?: InteractionPolicy;
  output?: OutputPolicy;
  run: (ctx: CommandContext<Auth>) => void | Promise<void>;
}

export interface CommandRuntime {
  api?: () => SuperwallApi;
  nonInteractive?: boolean;
  renderer?: (mode: OutputMode) => Renderer;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  waitForPaint?: boolean;
}

export type DefinedCommand<Auth extends AuthPolicy = AuthPolicy> = ((
  argv: Arguments,
) => Promise<void>) & {
  definition: CommandDefinition<Auth>;
};

export function defineCommand<Auth extends AuthPolicy = "none">(
  definition: CommandDefinition<Auth>,
): DefinedCommand<Auth> {
  const command = (argv: Arguments) => executeCommand(definition, argv);
  command.definition = definition;
  return command;
}

export async function executeCommand<Auth extends AuthPolicy>(
  definition: CommandDefinition<Auth>,
  argv: Arguments,
  runtime: CommandRuntime = {},
): Promise<void> {
  const json = Boolean(argv.json);
  const environmentNonInteractive = runtime.nonInteractive ?? isNonInteractive();
  const explicitNonInteractive = argv.interactive === false;
  const outputMode: OutputMode = json ? "json" : environmentNonInteractive ? "text" : "rich";
  const interactive =
    definition.interaction !== "none" &&
    !json &&
    !explicitNonInteractive &&
    !environmentNonInteractive;
  const installDir = resolve((argv.installDir as string | undefined) ?? process.cwd());
  const ui = runtime.renderer
    ? useRenderer(runtime.renderer(outputMode))
    : selectRenderer({ mode: outputMode });
  const stdout = runtime.stdout ?? process.stdout;
  const output = createCommandOutput(outputMode, ui, { stdout });

  if (json && definition.output !== "json" && definition.output !== "both") {
    writeJson(stdout, {
      error: {
        code: "json_not_supported",
        message: `${definition.name} does not support --json.`,
      },
    });
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const base = commandTelemetry(definition, argv, { json, interactive });

  ui.start();
  const offInterrupt = ui.onInterrupt?.(() => {
    ui.stop();
    process.stderr.write("\n✗ Cancelled.\n");
    process.exit(130);
  });
  if (outputMode === "rich") maybeShowTelemetryNotice(ui);
  track("command started", base);
  try {
    const api = resolveApi(definition.auth ?? "none", runtime.api ?? superwallApi);
    if (definition.auth && definition.auth !== "none") base.logged_in = api !== undefined;
    const context = {
      argv,
      ui,
      output,
      outputMode,
      interactive,
      installDir,
      json,
      dryRun: Boolean(argv.dryRun),
      ...(api ? { api } : {}),
    } as CommandContext<Auth>;
    await definition.run(context);
    track("command finished", {
      ...base,
      status: "success",
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    reportError(ui, outputMode, stdout, error);
    process.exitCode = 1;
    const { code, status } = normalizeError(error);
    track("command finished", {
      ...base,
      status: "error",
      error_code: code,
      ...(status === undefined ? {} : { http_status: status }),
      duration_ms: Date.now() - startedAt,
    });
  } finally {
    offInterrupt?.();
    if (outputMode !== "json") refreshUpdateCheck();
    if (outputMode === "rich" && runtime.waitForPaint !== false) {
      await new Promise((done) => setTimeout(done, 50));
    }
    ui.stop();
    if (outputMode !== "json" && definition.name !== "upgrade") {
      maybeNotifyUpdate(stdout);
    }
  }
}

const BARE_WORD = /^[a-z][a-z-]{0,31}$/;

export function commandTelemetry(
  definition: { name: string; auth?: AuthPolicy },
  argv: Arguments,
  flags: { json: boolean; interactive: boolean },
): Record<string, unknown> {
  const subcommand = [argv.target, argv.action]
    .map((value) => (typeof value === "string" ? value : undefined))
    .filter((value): value is string => value !== undefined && BARE_WORD.test(value));
  return {
    command: definition.name,
    ...(subcommand.length === 0 ? {} : { subcommand: subcommand.join(" ") }),
    auth: definition.auth ?? "none",
    json: flags.json,
    prompts: flags.interactive,
    dry_run: Boolean(argv.dryRun),
    skill: argv.skill === true,
  };
}

function resolveApi(policy: AuthPolicy, factory: () => SuperwallApi): SuperwallApi | undefined {
  if (policy === "required") return factory();
  if (policy === "optional") {
    try {
      return factory();
    } catch (error) {
      if (error instanceof NotLoggedInError) return undefined;
      throw error;
    }
  }
  return undefined;
}

function reportError(
  ui: Renderer,
  mode: OutputMode,
  stdout: Pick<NodeJS.WriteStream, "write">,
  error: unknown,
): void {
  const { code, message, status } = normalizeError(error);
  if (mode === "json") {
    writeJson(stdout, { error: { code, message, ...(status === undefined ? {} : { status }) } });
    return;
  }
  ui.error([message, ...errorAside(error)].join("\n"));
}

export function errorAside(error: unknown): string[] {
  const aside: string[] = [];
  if (error instanceof ApiError) {
    if (error.hint) aside.push(error.hint);
    if (error.detail.docUrl) aside.push(error.detail.docUrl);
    if (!error.envelope) aside.push(error.request);
  }
  return aside.map((line) => pc.dim(line));
}

export function normalizeError(error: unknown): {
  code: string;
  message: string;
  status?: number;
} {
  if (error instanceof NotLoggedInError) {
    return {
      code: "not_logged_in",
      message: "You aren't logged in. Run `superwall login` first.",
    };
  }
  if (error instanceof ApiError) {
    return { code: "api_error", message: error.message, status: error.status };
  }
  return {
    code: "command_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
