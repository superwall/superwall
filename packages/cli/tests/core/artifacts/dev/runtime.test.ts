import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { HOST_MODULE, MAIN_MODULE, SANDBOX_MODULE, startMiniflare } from "@/core/artifacts/dev/runtime";
import { ARTIFACT_COMPATIBILITY_DATE } from "@/core/artifacts/wire";
import { artifactProject } from "../fixture";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__fakeMiniflare");
});

function installFakeMiniflare(root: string, { convert = true, failReady = false } = {}): void {
  const wrangler = path.join(root, "node_modules", "wrangler");
  const miniflare = path.join(root, "node_modules", "miniflare");
  fs.mkdirSync(wrangler, { recursive: true });
  fs.mkdirSync(miniflare, { recursive: true });
  fs.writeFileSync(path.join(wrangler, "package.json"), JSON.stringify({ name: "wrangler", version: "1.0.0" }));
  fs.writeFileSync(path.join(miniflare, "package.json"), JSON.stringify({ name: "miniflare", version: "1.0.0", main: "index.mjs", type: "module" }));
  fs.writeFileSync(
    path.join(miniflare, "index.mjs"),
    `const state = (globalThis.__fakeMiniflare = { options: [], dispatched: [], disposed: 0 });
     export class Miniflare {
       constructor(options) { state.options.push(options); this.ready = ${failReady ? 'Promise.reject(new Error("no runtime"))' : "Promise.resolve()"}; }
       dispatchFetch(url, init) { state.dispatched.push({ url, init }); return Promise.resolve(new globalThis.Response("ok")); }
       setOptions(options) { state.options.push(options); return Promise.resolve(); }
       dispose() { state.disposed += 1; return Promise.resolve(); }
     }
     export const Response = globalThis.Response;
     ${convert ? "export const convertV4MiniflareOptions = (options) => ({ converted: true, ...options });" : ""}`,
  );
}

const fake = () =>
  Reflect.get(globalThis, "__fakeMiniflare") as { options: any[]; dispatched: any[]; disposed: number };

test("hands the host Worker the module, a loader and both egress paths, then converts the options", async () => {
  const root = artifactProject();
  installFakeMiniflare(root);
  const callers: unknown[] = [];
  const outbound = async (_request: Request, caller: unknown) => {
    callers.push(caller);
    return new Response(null, { status: 304, headers: { a: "b" } });
  };
  const runtime = await startMiniflare({ root, module: "CODE", outbound });
  const [options] = fake().options;
  assert.equal(options.converted, true);
  const [worker] = options.workers;
  assert.equal(worker.compatibilityDate, ARTIFACT_COMPATIBILITY_DATE);
  assert.equal(worker.bindings.CUSTOMER_MODULE, "CODE");
  assert.deepEqual(worker.workerLoaders, { LOADER: {} });

  const answer: Response = await worker.serviceBindings.EGRESS(new Request("https://x.test"));
  assert.equal(answer.status, 304);
  assert.equal(answer.body, null);
  assert.equal(answer.headers.get("a"), "b");
  await worker.serviceBindings.EGRESS_APP(new Request("https://x.test"));
  assert.deepEqual(callers, [{ narrowed: false }, { narrowed: true }]);

  await runtime.fetch("http://localhost/x", { method: "GET" });
  assert.equal(fake().dispatched[0].init.redirect, "manual");
  await runtime.update("NEXT");
  assert.equal(fake().options[1].workers[0].bindings.CUSTOMER_MODULE, "NEXT");
  await runtime.dispose();
  assert.equal(fake().disposed, 1);
});

test("an older miniflare takes the options as they are", async () => {
  const root = artifactProject();
  installFakeMiniflare(root, { convert: false });
  await startMiniflare({ root, module: "CODE", outbound: async () => new Response() });
  assert.equal(fake().options[0].converted, undefined);
});

test("a runtime that won't start cleans up and says what to try", async () => {
  const root = artifactProject();
  installFakeMiniflare(root, { failReady: true });
  await assert.rejects(
    startMiniflare({ root, module: "CODE", outbound: async () => new Response() }),
    /didn't start: no runtime[\s\S]*wrangler@latest/,
  );
  assert.equal(fake().disposed, 1);
});

test("the host passes a JS entrypoint as globalOutbound, which is what stops connect()", () => {
  assert.equal(SANDBOX_MODULE, "delete globalThis.caches\n");
  assert.match(MAIN_MODULE, /import ".\/sandbox\.mjs"\n/);
  assert.match(HOST_MODULE, /export class Egress extends WorkerEntrypoint/);
  assert.match(HOST_MODULE, /globalOutbound: exports\.Egress\(/);
  assert.doesNotMatch(HOST_MODULE, /globalOutbound: env\./);
});
