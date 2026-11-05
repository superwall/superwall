import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveWranglerPackage, type BundleCompatibility } from "@/core/artifacts/bundle";
import { ARTIFACT_COMPATIBILITY_DATE } from "@/core/artifacts/wire";
import { ArtifactError } from "@/core/artifacts/project";
import { rebuildResponse } from "./outbound";

export const INVOKE_PATH = "/__sw/invoke/";
const NARROWED_HEADER = "x-superwall-artifact-dev-narrowed";
const INVOCABLE = ["metric", "readout"];

export const SANDBOX_MODULE = "delete globalThis.caches\n";

export const MAIN_MODULE = `import "./sandbox.mjs"
import { WorkerEntrypoint } from "cloudflare:workers"
import handlers from "./worker.mjs"
export * from "./worker.mjs"
export default class Artifact extends WorkerEntrypoint {
  fetch(request) {
    return handlers.fetch(request)
  }
  metric(request) {
    if (typeof handlers.metric !== "function") {
      throw new Error("This artifact has no metric handler")
    }
    return handlers.metric(request)
  }
  readout(request) {
    if (typeof handlers.readout !== "function") {
      throw new Error("This artifact has no readout handler")
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
    compatibilityFlags: env.COMPATIBILITY_FLAGS,
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
    const artifact = load(env, ctx.exports, narrowed).getEntrypoint()
    if (pathname.startsWith(${JSON.stringify(INVOKE_PATH)})) {
      const kind = pathname.slice(${INVOKE_PATH.length})
      if (!${JSON.stringify(INVOCABLE)}.includes(kind)) return json({ error: "Not found." }, 404)
      try {
        return json({ result: await artifact[kind](await request.json()) }, 200)
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 500)
      }
    }
    const headers = new Headers(request.headers)
    headers.delete(${JSON.stringify(NARROWED_HEADER)})
    try {
      return await artifact.fetch(new Request(request, { headers }))
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
  update(module: string, compatibility?: BundleCompatibility): Promise<void>;
  dispose(): Promise<void>;
}

export interface RuntimeOptions {
  root: string;
  module: string;
  compatibility?: BundleCompatibility;
  outbound: Outbound;
}

export type StartRuntime = (options: RuntimeOptions) => Promise<DevRuntime>;

const DEFAULT_COMPATIBILITY: BundleCompatibility = { date: ARTIFACT_COMPATIBILITY_DATE, flags: [] };

export const workerOptions = (module: string, compatibility: BundleCompatibility = DEFAULT_COMPATIBILITY) => ({
  name: "artifact-host",
  compatibilityDate: ARTIFACT_COMPATIBILITY_DATE,
  modules: [{ type: "ESModule", path: "host.mjs", contents: HOST_MODULE }],
  bindings: { CUSTOMER_MODULE: module, COMPATIBILITY_DATE: compatibility.date, COMPATIBILITY_FLAGS: compatibility.flags },
  workerLoaders: { LOADER: {} },
});

export const startMiniflare: StartRuntime = async ({ root, module, compatibility, outbound }) => {
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
  const options = (code: string, runsOn?: BundleCompatibility) =>
    convertV4MiniflareOptions({
      workers: [
        {
          ...workerOptions(code, runsOn),
          serviceBindings: { EGRESS: egress({ narrowed: false }), EGRESS_APP: egress({ narrowed: true }) },
        },
      ],
    });
  const miniflare = new Miniflare(options(module, compatibility));
  try {
    await miniflare.ready;
  } catch (error) {
    await miniflare.dispose().catch(() => {});
    throw new ArtifactError(
      `The artifact didn't start: ${(error as Error).message}\nIf the runtime says the compatibility date is too new, update wrangler with \`npm install -D wrangler@latest\`.`,
    );
  }
  return {
    fetch: (url, init, caller) => {
      const headers = new Headers(init.headers);
      if (caller?.narrowed) headers.set(NARROWED_HEADER, "1");
      return miniflare.dispatchFetch(url, { ...init, headers, redirect: "manual" });
    },
    update: (code, runsOn) => miniflare.setOptions(options(code, runsOn)),
    dispose: () => miniflare.dispose(),
  };
};
