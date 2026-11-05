import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandContext } from "@/program/command";
import { ApiError } from "@/core/api/client";
import { bundleWorkspace, type RunWrangler } from "@/core/workspaces/bundle";
import { resolveAppScope, resolveOrganization } from "@/core/workspaces/organization";
import { MANIFEST_FILE, readManifest, readProject, WorkspaceError } from "@/core/workspaces/project";
import { warnIfSdkBehind } from "@/core/workspaces/sdk";
import type { ContextInput } from "@/core/workspaces/slots";
import { createOutbound, type AgentCredential } from "./outbound";
import { startMiniflare, type StartRuntime } from "./runtime";
import { startDevServer } from "./server";

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

const WATCHED = ["src", "vendor", MANIFEST_FILE, "wrangler.jsonc", "wrangler.json", "wrangler.toml"];
const DEBOUNCE_MS = 150;

function watchProject(root: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };
  const watchers = WATCHED.map((name) => path.join(root, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.watch(file, { recursive: fs.statSync(file).isDirectory() }, changed));
  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

function agentCredential(ctx: CommandContext<"required">): AgentCredential {
  const mint = async () => {
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
  };
  let token: Promise<string> | undefined;
  return {
    current: () => (token ??= mint()),
    renew: () => (token = mint()),
  };
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
  if (input.context !== undefined) return context;
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

  const server = await startDevServer({ getManifest: () => manifest, runtime, port: input.port, defaults });

  let rebuilding: Promise<void> = Promise.resolve();
  const rebuild = (): Promise<void> => {
    rebuilding = rebuilding.then(async () => {
      try {
        manifest = readManifest(root);
        const next = await bundleWorkspace(root, seams.wrangler);
        await runtime.update(next.module);
        ctx.ui.step(`Rebuilt, ${next.bytes} bytes`);
        server.publish({ type: "reload" });
      } catch (error) {
        ctx.ui.error((error as Error).message);
        server.publish({ type: "error", message: (error as Error).message });
      }
    });
    return rebuilding;
  };
  const unwatch = watchProject(root, () => void rebuild());

  ctx.ui.success(`Open ${server.hostOrigin}`);
  ctx.ui.info("API calls use a read-only token as you. Writes and outside hosts are refused.");
  seams.onReady?.({ host: server.hostOrigin, frame: server.frameOrigin }, rebuild);

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      unwatch();
      await rebuilding;
      await server.close();
      await runtime.dispose();
    })();
    return stopping;
  };
  const offInterrupt = ctx.ui.onInterrupt?.(() => void stop());
  try {
    await (seams.until ?? waitForSignal)(stop);
  } finally {
    offInterrupt?.();
    await stop();
  }
}
