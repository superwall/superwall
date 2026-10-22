import pc from "picocolors";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { NotLoggedInError } from "@/core/account/errors";
import { createCommandOutput, type OutputMode, writeJson } from "@/program/output";
import { useRenderer } from "@/ui";
import type { Renderer } from "@/ui/types";
import { UsageError, type AuthPolicy, type CommandContext, type CommandRuntime, type RawInput } from "./command";
import { currentHost, type Writable } from "./host";

function textOf(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export async function runLifecycle<Auth extends AuthPolicy>(
  description: { name: string; auth: AuthPolicy; json: boolean; prompts: boolean },
  input: RawInput,
  runtime: CommandRuntime,
  work: (ctx: CommandContext<Auth>) => void | Promise<void>,
): Promise<void> {
  const host = { ...currentHost(), ...runtime };
  const flags = input.flags ?? {};
  const json = input.json === true;
  const outputMode: OutputMode = json ? "json" : host.nonInteractive ? "text" : "rich";
  const interactive = description.prompts && !json && input.interactive !== false && !host.nonInteractive;
  const installDir = host.installDir(textOf(flags.installDir));
  const ui = useRenderer(host.renderer(outputMode));
  const { stdout } = host;
  const output = createCommandOutput(outputMode, ui, { stdout });

  if (json && !description.json) {
    writeJson(stdout, {
      error: { code: "json_not_supported", message: `${description.name} does not support --json.` },
    });
    host.fail();
    return;
  }

  const startedAt = Date.now();
  const base: Record<string, unknown> = {
    command: description.name,
    auth: description.auth,
    json,
    prompts: interactive,
    dry_run: flags.dryRun === true,
    skill: flags.skill === true,
  };

  ui.start();
  const offInterrupt = ui.onInterrupt?.(() => {
    ui.stop();
    process.stderr.write("\n✗ Cancelled.\n");
    process.exit(130);
  });
  host.starting(ui, outputMode);
  host.track("command started", base);
  try {
    const api = resolveApi(description.auth, host.api);
    if (description.auth !== "none") base.logged_in = api !== undefined;
    const context: CommandContext = {
      ui,
      output,
      outputMode,
      interactive,
      installDir,
      json,
      dryRun: flags.dryRun === true,
      target: { app: textOf(flags.app), project: textOf(flags.project) },
      fail: host.fail,
      ...(api ? { api } : {}),
    };
    await work(context as CommandContext<Auth>);
    host.track("command finished", { ...base, status: "success", duration_ms: Date.now() - startedAt });
  } catch (error) {
    renderError(ui, outputMode, stdout, error);
    host.fail();
    const { code, status } = normalizeError(error);
    host.track("command finished", {
      ...base,
      status: "error",
      error_code: code,
      ...(status === undefined ? {} : { http_status: status }),
      duration_ms: Date.now() - startedAt,
    });
  } finally {
    offInterrupt?.();
    if (outputMode === "rich" && host.waitForPaint) {
      await new Promise((done) => setTimeout(done, 50));
    }
    ui.stop();
    host.finishing(stdout, outputMode, description.name);
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

function renderError(ui: Renderer, mode: OutputMode, stdout: Writable, error: unknown): void {
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

export function normalizeError(error: unknown): { code: string; message: string; status?: number } {
  if (error instanceof NotLoggedInError) {
    return { code: "not_logged_in", message: "You aren't logged in. Run `superwall login` first." };
  }
  if (error instanceof UsageError) return { code: "invalid_arguments", message: error.message };
  if (error instanceof ApiError) return { code: "api_error", message: error.message, status: error.status };
  return { code: "command_error", message: error instanceof Error ? error.message : String(error) };
}
