import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { MAIN_MODULE, SANDBOX_MODULE, startMiniflare, workerOptions } from "@/core/workspaces/dev/runtime";
import { WORKSPACE_COMPATIBILITY_DATE } from "@/core/workspaces/wire";
import { workspaceProject } from "../fixture";

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
    `const state = (globalThis.__fakeMiniflare = { options: [], dispatched: [], narrowed: [], disposed: 0 });
     export class Miniflare {
       constructor(options) { state.options.push(options); this.ready = ${failReady ? 'Promise.reject(new Error("no runtime"))' : "Promise.resolve()"}; }
       dispatchFetch(url, init) { state.dispatched.push({ url, init }); return Promise.resolve(new globalThis.Response("ok")); }
       getWorker(name) { return Promise.resolve({ fetch: (url, init) => { state.narrowed.push({ name, url, init }); return Promise.resolve(new globalThis.Response("app")); } }); }
       setOptions(options) { state.options.push(options); return Promise.resolve(); }
       dispose() { state.disposed += 1; return Promise.resolve(); }
     }
     export const Response = globalThis.Response;
     ${convert ? "export const convertV4MiniflareOptions = (options) => ({ converted: true, ...options });" : ""}`,
  );
}

const fake = () =>
  Reflect.get(globalThis, "__fakeMiniflare") as { options: any[]; dispatched: any[]; narrowed: any[]; disposed: number };

test("runs the module in the project's own miniflare, on the platform's date, with its modules", async () => {
  const root = workspaceProject();
  installFakeMiniflare(root);
  const callers: unknown[] = [];
  const outbound = async (_request: Request, caller: unknown) => {
    callers.push(caller);
    return new Response("out", { status: 201, headers: { a: "b" } });
  };
  const runtime = await startMiniflare({ root, module: "CODE", outbound });
  const [options] = fake().options;
  assert.equal(options.converted, true);
  const worker = options.workers[0];
  assert.equal(worker.compatibilityDate, WORKSPACE_COMPATIBILITY_DATE);
  assert.deepEqual(worker.modules.map((module: { path: string }) => module.path), ["platform.mjs", "sandbox.mjs", "worker.mjs"]);
  assert.equal(worker.modules[2].contents, "CODE");

  const answer: Response = await worker.outboundService(new Request("https://x.test"));
  assert.equal(answer.status, 201);
  assert.equal(answer.headers.get("a"), "b");
  assert.equal(await answer.text(), "out");
  const narrowed = options.workers[1];
  assert.deepEqual(narrowed.modules, worker.modules);
  await narrowed.outboundService(new Request("https://x.test"));
  assert.deepEqual(callers, [{ narrowed: false }, { narrowed: true }]);

  await runtime.fetch("http://localhost/x", { method: "GET" });
  assert.equal(fake().dispatched[0].init.redirect, "manual");
  await runtime.fetch("http://localhost/y", { method: "GET" }, { narrowed: true });
  assert.equal(fake().dispatched.length, 1);
  assert.equal(fake().narrowed[0].name, narrowed.name);
  assert.equal(fake().narrowed[0].init.redirect, "manual");
  await runtime.update("NEXT");
  assert.equal(fake().options[1].workers[0].modules[2].contents, "NEXT");
  assert.equal(fake().options[1].workers[1].modules[2].contents, "NEXT");
  await runtime.dispose();
  assert.equal(fake().disposed, 1);
});

test("an older miniflare takes the options as they are", async () => {
  const root = workspaceProject();
  installFakeMiniflare(root, { convert: false });
  await startMiniflare({ root, module: "CODE", outbound: async () => new Response() });
  assert.equal(fake().options[0].converted, undefined);
});

test("a runtime that won't start says what to try", async () => {
  const root = workspaceProject();
  installFakeMiniflare(root, { failReady: true });
  await assert.rejects(
    startMiniflare({ root, module: "CODE", outbound: async () => new Response() }),
    /didn't start: no runtime[\s\S]*wrangler@latest/,
  );
});

test("the platform modules remove the cache and hand the worker every other path", async () => {
  assert.equal(SANDBOX_MODULE, "delete globalThis.caches\n");
  assert.match(MAIN_MODULE, /import "\.\/sandbox\.mjs"\n/);
  assert.equal(workerOptions("x").modules.length, 3);
  const body = MAIN_MODULE.replace(/^import .*$/gm, "").replace("export default", "return");
  const worker = (handlers: unknown) => new Function("handlers", body)(handlers);
  const call = (handlers: unknown, url: string, payload?: unknown) =>
    worker(handlers).fetch(new Request(url, payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) }));
  const plain = await call({ fetch: () => new Response("page") }, "http://x/home");
  assert.equal(await plain.text(), "page");
  const metric = await call({ metric: (request: unknown) => ({ echoed: request }) }, "http://x/__sw/invoke/metric", { a: 1 });
  assert.deepEqual(await metric.json(), { result: { echoed: { a: 1 } } });
  const missing = await call({}, "http://x/__sw/invoke/readout", {});
  assert.equal(missing.status, 501);
  const broken = await call({ metric: () => { throw new Error("bad sql"); } }, "http://x/__sw/invoke/metric", {});
  assert.deepEqual(await broken.json(), { error: "bad sql" });
});
