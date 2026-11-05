import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveWranglerPackage } from "@/core/workspaces/bundle";
import { WORKSPACE_COMPATIBILITY_DATE } from "@/core/workspaces/wire";
import { WorkspaceError } from "@/core/workspaces/project";
import { rebuildResponse } from "./outbound";

export const INVOKE_PATH = "/__sw/invoke/";
const NARROWED_HEADER = "x-superwall-workspace-dev-narrowed";
const INVOCABLE = ["metric", "readout"];

export const SANDBOX_MODULE = "delete globalThis.caches\n";

export const MAIN_MODULE = `import "./sandbox.mjs"
import { WorkerEntrypoint } from "cloudflare:workers"
import handlers from "./worker.mjs"
export * from "./worker.mjs"
export default class Workspace extends WorkerEntrypoint {
  fetch(request) {
    return handlers.fetch(request)
  }
  metric(request) {
    if (typeof handlers.metric !== "function") {
      throw new Error("This workspace has no metric handler")
    }
    return handlers.metric(request)
  }
  readout(request) {
    if (typeof handlers.readout !== "function") {
      throw new Error("This workspace has no readout handler")
    }
    return handlers.readout(request)
  }
}
`;

export const HOST_MODULE = `import { WorkerEntrypoint } from "cloudflare:workers"
const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
export class Egress extends WorkerEntrypoint {
  fetch(request) {
    return (this.ctx.props.narrowed ? this.env.EGRESS_APP : this.env.EGRESS).fetch(request)
  }
}
const load = (env, exports, narrowed) =>
  env.LOADER.get(narrowed ? "app" : "organization", () => ({
    compatibilityDate: env.COMPATIBILITY_DATE,
    mainModule: "platform.mjs",
    modules: {
      "platform.mjs": { js: ${JSON.stringify(MAIN_MODULE)} },
      "sandbox.mjs": { js: ${JSON.stringify(SANDBOX_MODULE)} },
      "worker.mjs": { js: env.CUSTOMER_MODULE },
    },
    env: {},
    globalOutbound: exports.Egress({ props: { narrowed } }),
  }))
export default {
  async fetch(request, env, ctx) {
    const narrowed = request.headers.get(${JSON.stringify(NARROWED_HEADER)}) === "1"
    const { pathname } = new URL(request.url)
    const workspace = load(env, ctx.exports, narrowed).getEntrypoint()
    if (pathname.startsWith(${JSON.stringify(INVOKE_PATH)})) {
      const kind = pathname.slice(${INVOKE_PATH.length})
      if (!${JSON.stringify(INVOCABLE)}.includes(kind)) return json({ error: "Not found." }, 404)
      try {
        return json({ result: await workspace[kind](await request.json()) }, 200)
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 500)
      }
    }
    const headers = new Headers(request.headers)
    headers.delete(${JSON.stringify(NARROWED_HEADER)})
    try {
      return await workspace.fetch(new Request(request, { headers }))
    } catch (error) {
      return new Response(String(error?.message ?? error), { status: 502 })
    }
  },
}
`;

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
  name: "workspace-host",
  compatibilityDate: WORKSPACE_COMPATIBILITY_DATE,
  modules: [{ type: "ESModule", path: "host.mjs", contents: HOST_MODULE }],
  bindings: { CUSTOMER_MODULE: module, COMPATIBILITY_DATE: WORKSPACE_COMPATIBILITY_DATE },
  workerLoaders: { LOADER: {} },
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
      setOptions(options: unknown): Promise<void>;
      dispose(): Promise<void>;
    };
    Response: typeof Response;
    convertV4MiniflareOptions?: (options: unknown) => unknown;
  };
  const egress = (caller: CallerScope) => async (request: Request) =>
    rebuildResponse(await outbound(request, caller), RuntimeResponse);
  const options = (code: string) =>
    convertV4MiniflareOptions({
      workers: [
        {
          ...workerOptions(code),
          serviceBindings: { EGRESS: egress({ narrowed: false }), EGRESS_APP: egress({ narrowed: true }) },
        },
      ],
    });
  const miniflare = new Miniflare(options(module));
  try {
    await miniflare.ready;
  } catch (error) {
    await miniflare.dispose().catch(() => {});
    throw new WorkspaceError(
      `The workspace didn't start: ${(error as Error).message}\nIf the runtime says the compatibility date is too new, update wrangler with \`npm install -D wrangler@latest\`.`,
    );
  }
  return {
    fetch: (url, init, caller) => {
      const headers = new Headers(init.headers);
      if (caller?.narrowed) headers.set(NARROWED_HEADER, "1");
      return miniflare.dispatchFetch(url, { ...init, headers, redirect: "manual" });
    },
    update: (code) => miniflare.setOptions(options(code)),
    dispose: () => miniflare.dispose(),
  };
};
