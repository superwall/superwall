import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandContext } from "@/program/command";
import { ApiError } from "@/core/api/client";
import { bundleWorkspace, type RunWrangler } from "@/core/workspaces/bundle";
import { resolveAppScope, resolveOrganization } from "@/core/workspaces/organization";
import { MANIFEST_FILE, readManifest, readProject, WorkspaceError } from "@/core/workspaces/project";
import { warnIfSdkBehind } from "@/core/workspaces/sdk";
import type { ContextInput } from "@/core/workspaces/slots";
import { createAgentCredential } from "./credential";
import { createOutbound } from "./outbound";
import { startMiniflare, type StartRuntime } from "./runtime";
import { startDevServer, type DevServer } from "./server";

export interface DevInput {
  dir?: string;
  port: number;
  org?: string;
  app?: string;
  campaign?: string;
  audience?: string;
  variant?: readonly string[];
  user?: string;
  alias?: readonly string[];
  environment?: string;
  from?: string;
  to?: string;
  context?: string;
}

export interface DevRuntimeSeams {
  startRuntime?: StartRuntime;
  wrangler?: RunWrangler;
  until?: (stop: () => Promise<void>) => Promise<void>;
  fetchImpl?: typeof fetch;
  onReady?: (urls: { host: string; frame: string }, rebuild: () => Promise<void>) => void;
}

const WATCHED_DIRS = ["src", "vendor"];
const WATCHED_FILES = new Set([MANIFEST_FILE, "wrangler.jsonc", "wrangler.json", "wrangler.toml"]);
const DEBOUNCE_MS = 150;

function watchProject(root: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };
  const nested = new Map<string, fs.FSWatcher>();
  const attach = (name: string) => {
    nested.get(name)?.close();
    nested.delete(name);
    const dir = path.join(root, name);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      nested.set(name, fs.watch(dir, { recursive: true }, changed));
    }
  };
  for (const name of WATCHED_DIRS) attach(name);
  const top = fs.watch(root, (_event, file) => {
    if (file === null || WATCHED_FILES.has(file)) changed();
    if (file !== null && WATCHED_DIRS.includes(file)) {
      attach(file);
      changed();
    }
  });
  return () => {
    clearTimeout(timer);
    top.close();
    for (const watcher of nested.values()) watcher.close();
  };
}

function agentCredential(ctx: CommandContext<"required">) {
  return createAgentCredential(async () => {
    try {
      const { token } = await ctx.api.post<{ token: string }>("/v2/me/agent-token", {});
      return token;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new WorkspaceError(
          "`superwall workspaces dev` needs a browser login: it makes its read-only token from your session, and an API key can't. Run `superwall login`.",
        );
      }
      throw error;
    }
  });
}

const waitForSignal = (stop: () => Promise<void>): Promise<void> =>
  new Promise((resolve) => {
    const finish = () => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      void stop().finally(resolve);
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });

async function resolveDefaults(ctx: CommandContext<"required">, input: DevInput): Promise<ContextInput> {
  const context: ContextInput = {
    campaignId: input.campaign,
    audienceId: input.audience,
    variantIds: input.variant,
    appUserId: input.user,
    aliases: input.alias,
    environment: input.environment,
    from: input.from,
    to: input.to,
    context: input.context,
  };
  if (input.context !== undefined && input.app === undefined && input.org === undefined) return context;
  const scope =
    input.app === undefined
      ? { organizationId: await resolveOrganization(ctx, input.org) }
      : await resolveAppScope(ctx.api, input.app, input.org);
  return { ...context, ...scope };
}

export async function runWorkspaceDev(
  ctx: CommandContext<"required">,
  input: DevInput,
  seams: DevRuntimeSeams = {},
): Promise<void> {
  const { root } = readProject(input.dir);
  ctx.ui.intro("Workspace dev");
  void warnIfSdkBehind(ctx.ui, root);
  const defaults = await resolveDefaults(ctx, input);
  const credential = agentCredential(ctx);
  await credential.current();

  const first = await bundleWorkspace(root, seams.wrangler);
  const log = { info: (text: string) => ctx.ui.step(text), warn: (text: string) => ctx.ui.warn(text) };
  let manifest = readManifest(root);
  const runtime = await (seams.startRuntime ?? startMiniflare)({
    root,
    module: first.module,
    outbound: createOutbound({
      apiOrigin: ctx.api.host,
      credential,
      log,
      declaredScopes: () => manifest.scopes,
      ...(seams.fetchImpl ? { fetchImpl: seams.fetchImpl } : {}),
    }),
  });

  let server: DevServer | undefined;
  let unwatch: (() => void) | undefined;
  let rebuilding: Promise<void> = Promise.resolve();
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      unwatch?.();
      await rebuilding;
      await server?.close();
      await runtime.dispose();
    })();
    return stopping;
  };
  const offCancel = ctx.onCancel?.(stop);
  try {
    const started = await startDevServer({ getManifest: () => manifest, runtime, port: input.port, defaults });
    server = started;
    const rebuild = (): Promise<void> => {
      rebuilding = rebuilding.then(async () => {
        try {
          const nextManifest = readManifest(root);
          const next = await bundleWorkspace(root, seams.wrangler);
          await runtime.update(next.module);
          manifest = nextManifest;
          ctx.ui.step(`Rebuilt, ${next.bytes} bytes`);
          started.publish({ type: "reload" });
        } catch (error) {
          ctx.ui.error((error as Error).message);
          started.publish({ type: "error", message: (error as Error).message });
        }
      });
      return rebuilding;
    };
    unwatch = watchProject(root, () => void rebuild());

    ctx.ui.success(`Open ${started.hostOrigin}`);
    ctx.ui.info("API calls use a read-only token as you. Writes, outside hosts and raw sockets are refused.");
    seams.onReady?.({ host: started.hostOrigin, frame: started.frameOrigin }, rebuild);
    await (seams.until ?? waitForSignal)(stop);
  } finally {
    offCancel?.();
    await stop();
  }
}
