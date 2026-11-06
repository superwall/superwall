import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandContext } from "@/program/command";
import { ApiError } from "@/core/api/client";
import { bundleArtifact, type RunWrangler } from "@/core/artifacts/bundle";
import { resolveAppScope, resolveOrganization } from "@/core/artifacts/organization";
import { ARTIFACT_FILE } from "@/core/paywalls/source/scope";
import { readManifest, readProject, ArtifactError } from "@/core/artifacts/project";
import { warnIfSdkBehind } from "@/core/artifacts/sdk";
import { parseContextJson, type ContextInput } from "@/core/artifacts/slots";
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

const UNWATCHED_DIRS = new Set(["node_modules", "dist"]);
const UNWATCHED_FILES = new Set([ARTIFACT_FILE]);
const DEBOUNCE_MS = 150;
const TOKEN_TTL_SECONDS = 60 * 60;

const SOURCE_FILE = /\.(?:tsx?|jsx?|mts|mjs|cts|cjs|css|jsonc?|toml|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/;

const isWatched = (name: string) => !name.startsWith(".") && !UNWATCHED_DIRS.has(name) && !UNWATCHED_FILES.has(name);

export function watchProject(root: string, onChange: () => void): () => void {
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
  for (const name of fs.readdirSync(root).filter(isWatched)) attach(name);
  const top = fs.watch(root, (_event, file) => {
    if (file === null) {
      changed();
    } else if (isWatched(file)) {
      const wasFolder = nested.has(file);
      attach(file);
      if (wasFolder || nested.has(file) || SOURCE_FILE.test(file)) changed();
    }
  });
  return () => {
    clearTimeout(timer);
    top.close();
    for (const watcher of nested.values()) watcher.close();
  };
}

function mintRefusal(error: ApiError): string {
  return /WorkOS access token/i.test(error.message)
    ? "`superwall artifacts dev` needs a browser login: it makes its read-only token from your session, and an API key can't. Run `superwall login`."
    : error.message;
}

function agentCredential(ctx: CommandContext<"required">, organizationId: string) {
  let limited = true;
  const credential = createAgentCredential(async () => {
    try {
      const minted = await ctx.api.post<{ token: string; organization_id?: number }>("/v2/me/agent-token", {
        ttl_seconds: TOKEN_TTL_SECONDS,
        organization_id: Number(organizationId),
      });
      if (minted.organization_id === undefined && limited) {
        limited = false;
        ctx.ui.warn("This API can't limit dev's token to one organization yet, so it reaches everything you can read.");
      }
      return minted.token;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) throw new ArtifactError(mintRefusal(error));
      throw error;
    }
  });
  return { credential, limitedTo: () => (limited ? organizationId : undefined) };
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

async function resolveDefaults(
  ctx: CommandContext<"required">,
  input: DevInput,
): Promise<ContextInput & { organizationId: string }> {
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
  const named = input.context === undefined ? undefined : parseContextJson(input.context).organizationId;
  const scope =
    input.app === undefined
      ? { organizationId: input.org ?? (named === undefined ? await resolveOrganization(ctx, undefined) : String(named)) }
      : await resolveAppScope(ctx.api, input.app, input.org);
  const { organizationId } = scope;
  if (organizationId === undefined) {
    throw new ArtifactError(`Couldn't find the organization of app ${input.app}. Say which with --org <id>.`);
  }
  if (!/^[1-9]\d*$/.test(organizationId)) {
    throw new ArtifactError(`--org takes an organization's id, a number. Got ${organizationId}.`);
  }
  return { ...context, ...scope, organizationId };
}

export async function runArtifactDev(
  ctx: CommandContext<"required">,
  input: DevInput,
  seams: DevRuntimeSeams = {},
): Promise<void> {
  const { root } = readProject(input.dir);
  ctx.ui.intro("Artifact dev");
  void warnIfSdkBehind(ctx.ui, root);
  const defaults = await resolveDefaults(ctx, input);
  const { credential, limitedTo } = agentCredential(ctx, defaults.organizationId);
  await credential.current();

  const first = await bundleArtifact(root, seams.wrangler);
  const log = { info: (text: string) => ctx.ui.step(text), warn: (text: string) => ctx.ui.warn(text) };
  let manifest = readManifest(root);
  const runtime = await (seams.startRuntime ?? startMiniflare)({
    root,
    module: first.module,
    compatibility: first.compatibility,
    outbound: createOutbound({
      apiOrigin: ctx.api.host,
      credential,
      log,
      declaredScopes: () => manifest.scopes,
      limitedTo,
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
          const next = await bundleArtifact(root, seams.wrangler);
          await runtime.update(next.module, next.compatibility);
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
    const reach = limitedTo() === undefined ? "" : `, limited to organization ${defaults.organizationId}`;
    ctx.ui.info(`API calls use a read-only token as you${reach}. Writes, outside hosts and raw sockets are refused.`);
    seams.onReady?.({ host: started.hostOrigin, frame: started.frameOrigin }, rebuild);
    await (seams.until ?? waitForSignal)(stop);
  } finally {
    offCancel?.();
    await stop();
  }
}
