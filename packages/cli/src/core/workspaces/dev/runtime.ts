import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveWranglerPackage } from "@/core/workspaces/bundle";
import { WORKSPACE_COMPATIBILITY_DATE } from "@/core/workspaces/wire";
import { WorkspaceError } from "@/core/workspaces/project";

export const INVOKE_PATH = "/__sw/invoke/";

export const MAIN_MODULE = `import "./sandbox.mjs"
import handlers from "./worker.mjs"
const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
export default {
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (!pathname.startsWith("${INVOKE_PATH}")) return handlers.fetch(request)
    const kind = pathname.slice(${INVOKE_PATH.length})
    if (typeof handlers[kind] !== "function") {
      return json({ error: "This workspace has no " + kind + " handler." }, 501)
    }
    try {
      return json({ result: await handlers[kind](await request.json()) }, 200)
    } catch (error) {
      return json({ error: String(error?.message ?? error) }, 500)
    }
  },
}
`;

export const SANDBOX_MODULE = "delete globalThis.caches\n";

const NARROWED_WORKER = "workspace-app";

export interface CallerScope {
  narrowed: boolean;
}

export type Outbound = (request: Request, caller: CallerScope) => Promise<Response>;

export interface DevRuntime {
  fetch(url: string, init: RequestInit, caller?: CallerScope): Promise<Response>;
  update(module: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface RuntimeOptions {
  root: string;
  module: string;
  outbound: Outbound;
}

export type StartRuntime = (options: RuntimeOptions) => Promise<DevRuntime>;

export const workerOptions = (module: string) => ({
  compatibilityDate: WORKSPACE_COMPATIBILITY_DATE,
  modules: [
    { type: "ESModule", path: "platform.mjs", contents: MAIN_MODULE },
    { type: "ESModule", path: "sandbox.mjs", contents: SANDBOX_MODULE },
    { type: "ESModule", path: "worker.mjs", contents: module },
  ],
});

export const startMiniflare: StartRuntime = async ({ root, module, outbound }) => {
  const entry = createRequire(resolveWranglerPackage(root)).resolve("miniflare");
  const {
    Miniflare,
    Response: RuntimeResponse,
    convertV4MiniflareOptions = (options: unknown) => options,
  } = (await import(pathToFileURL(entry).href)) as {
    Miniflare: new (options: unknown) => {
      ready: Promise<unknown>;
      dispatchFetch(url: string, init: unknown): Promise<Response>;
      getWorker(name: string): Promise<{ fetch(url: string, init: unknown): Promise<Response> }>;
      setOptions(options: unknown): Promise<void>;
      dispose(): Promise<void>;
    };
    Response: typeof Response;
    convertV4MiniflareOptions?: (options: unknown) => unknown;
  };
  const outboundService = (caller: CallerScope) => async (request: Request) => {
    const answer = await outbound(request, caller);
    return new RuntimeResponse(await answer.arrayBuffer(), { status: answer.status, headers: answer.headers });
  };
  const options = (code: string) =>
    convertV4MiniflareOptions({
      workers: [
        { name: "workspace", ...workerOptions(code), outboundService: outboundService({ narrowed: false }) },
        { name: NARROWED_WORKER, ...workerOptions(code), outboundService: outboundService({ narrowed: true }) },
      ],
    });
  const miniflare = new Miniflare(options(module));
  try {
    await miniflare.ready;
  } catch (error) {
    throw new WorkspaceError(
      `The workspace didn't start: ${(error as Error).message}\nIf the runtime says the compatibility date is too new, update wrangler with \`npm install -D wrangler@latest\`.`,
    );
  }
  return {
    fetch: async (url, init, caller) => {
      const request = { ...init, redirect: "manual" };
      if (!caller?.narrowed) return miniflare.dispatchFetch(url, request);
      return (await miniflare.getWorker(NARROWED_WORKER)).fetch(url, request);
    },
    update: (code) => miniflare.setOptions(options(code)),
    dispose: () => miniflare.dispose(),
  };
};
