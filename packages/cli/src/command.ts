import { resolve } from "node:path";
import type { Arguments } from "yargs";
import { ApiError, SuperwallApi } from "@/core/api/client";
import { NotLoggedInError } from "@/core/auth/errors";
import { createCommandOutput, type CommandOutput, type OutputMode, writeJson } from "@/output";
import { maybeShowTelemetryNotice, track } from "@/core/telemetry";
import { maybeNotifyUpdate, refreshUpdateCheck } from "@/core/update";
import { selectRenderer } from "@/ui";
import type { Renderer } from "@/ui/types";
import { isNonInteractive } from "@/util/env";

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
  telemetry?: "workflow";
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
  const ui = runtime.renderer?.(outputMode) ?? selectRenderer({ mode: outputMode });
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

  // Dry runs are smoke tests, not usage.
  const tracked = definition.telemetry === "workflow" && !argv.dryRun;
  const startedAt = Date.now();

  ui.start();
  if (tracked) {
    if (outputMode === "rich") maybeShowTelemetryNotice(ui);
    track("workflow started", { workflow: definition.name });
  }
  try {
    const api = resolveApi(definition.auth ?? "none", runtime.api ?? SuperwallApi.fromSession);
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
    if (tracked)
      track("workflow finished", {
        workflow: definition.name,
        status: "success",
        duration_ms: Date.now() - startedAt,
      });
  } catch (error) {
    reportError(ui, outputMode, stdout, error);
    process.exitCode = 1;
    if (tracked)
      track("workflow finished", {
        workflow: definition.name,
        status: "error",
        error_code: normalizeError(error).code,
        duration_ms: Date.now() - startedAt,
      });
  } finally {
    if (outputMode !== "json") refreshUpdateCheck();
    if (outputMode === "rich" && runtime.waitForPaint !== false) {
      await new Promise((done) => setTimeout(done, 50));
    }
    ui.stop();
    // After the renderer closes: a timeline item here would dangle below the
    // `└` cap, and every command ends with one.
    if (outputMode !== "json" && definition.name !== "upgrade") {
      maybeNotifyUpdate(stdout);
    }
  }
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
  const normalized = normalizeError(error);
  if (mode === "json") {
    writeJson(stdout, { error: normalized });
    return;
  }
  ui.error(normalized.message);
}

function normalizeError(error: unknown): {
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
    return {
      code: "api_error",
      message: `${error.message}${error.body ? ` - ${error.body.slice(0, 300)}` : ""}`,
      status: error.status,
    };
  }
  return {
    code: "command_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
