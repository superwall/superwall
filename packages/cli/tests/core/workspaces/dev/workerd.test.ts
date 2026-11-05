import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { bundleWorkspace } from "@/core/workspaces/bundle";
import { createOutbound } from "@/core/workspaces/dev/outbound";
import { startMiniflare, type DevRuntime } from "@/core/workspaces/dev/runtime";
import { startDevServer, type DevServer } from "@/core/workspaces/dev/server";
import { scratch } from "../fixture";

const CLI_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const TOKEN = "agent-token-that-must-stay-in-node";

const WORKER = (socketPort: number, webSocketPort: number) => `
import { connect } from "cloudflare:sockets";
import { env as moduleEnv } from "cloudflare:workers";

const attempt = async (work) => {
  try {
    return new Response("LEAK " + (await work()), { status: 200 });
  } catch (error) {
    return new Response(String(error?.message ?? error), { status: 403 });
  }
};

const readSocket = async (socket) => {
  await socket.opened;
  const writer = socket.writable.getWriter();
  await writer.write(new TextEncoder().encode("GET / HTTP/1.0\\r\\n\\r\\n"));
  const { value } = await socket.readable.getReader().read();
  return new TextDecoder().decode(value);
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case "/connect":
        return attempt(() => readSocket(connect({ hostname: "127.0.0.1", port: ${socketPort} })));
      case "/connect-string":
        return attempt(() => readSocket(connect("127.0.0.1:${socketPort}")));
      case "/web-socket":
        return attempt(
          () =>
            new Promise((resolve, reject) => {
              const socket = new WebSocket("ws://127.0.0.1:${webSocketPort}/");
              socket.addEventListener("open", () => resolve("open"));
              socket.addEventListener("error", () => reject(new Error("refused")));
            }),
        );
      case "/outside":
        return new Response(String((await fetch("http://127.0.0.1:${socketPort}/")).status));
      case "/env":
        return Response.json({ env: Object.keys(env ?? {}), moduleEnv: Object.keys(moduleEnv ?? {}), hasCtx: ctx !== undefined });
      case "/caches":
        return new Response(typeof caches);
      case "/api": {
        const answer = await fetch("https://api.workspace.internal/v2/projects", { headers: { authorization: "Bearer stolen", cookie: "a=b" } });
        return Response.json({ status: answer.status, body: await answer.text(), headers: [...answer.headers.keys()] });
      }
      case "/sql": {
        const answer = await fetch("https://api.workspace.internal/v2/organizations/1/query", { method: "POST", body: "SELECT 1" });
        return new Response(answer.status + " " + (await answer.text()).slice(0, 80));
      }
      case "/not-modified":
        return new Response(String((await fetch("https://api.workspace.internal/v2/not-modified")).status));
      case "/stream":
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
              await new Promise((resolve) => setTimeout(resolve, 1500));
              controller.enqueue(new TextEncoder().encode("second"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      default:
        return new Response("page " + request.headers.get("x-superwall-workspace-trigger"));
    }
  },
  async metric(request) {
    if (request.metric === "throws") throw new Error("this workspace broke on purpose");
    return { points: [{ t: request.from, value: 1 }] };
  },
};
`;

const manifest = {
  name: "Real workerd",
  scopes: ["data:read"],
  entrypoints: [
    { id: "home", slot: "org.page@1", title: "Home", path: "/" },
    { id: "app", slot: "app.page@1", title: "App", path: "/" },
    { id: "count", slot: "chart.source@1", title: "Count", metric: { value_type: "number" } },
    { id: "throws", slot: "chart.source@1", title: "Throws", metric: { value_type: "number" } },
    { id: "lift", slot: "campaign.metric@1", title: "Lift", metric: { value_type: "number" } },
  ],
};

describe("dev on real workerd", () => {
  let runtime: DevRuntime;
  let server: DevServer;
  let socketServer: net.Server;
  let webSocketServer: http.Server;
  let socketConnections = 0;
  let webSocketUpgrades = 0;
  const apiCalls: { url: string; authorization: string | null; cookie: string | null }[] = [];
  const logged: string[] = [];

  const session = async (entrypoint: string) => {
    const created = await fetch(`${server.hostOrigin}/__dev/sessions`, {
      method: "POST",
      headers: { origin: server.hostOrigin },
      body: JSON.stringify({ entrypoint, input: {} }),
    });
    const { connect_url } = (await created.json()) as { connect_url: string };
    const connected = await fetch(connect_url, { redirect: "manual" });
    return connected.headers.get("set-cookie")!.split(";")[0]!;
  };

  const page = async (pathname: string, entrypoint = "home") =>
    fetch(`${server.frameOrigin}${pathname}`, { headers: { cookie: await session(entrypoint) } });

  before(async () => {
    socketServer = net.createServer((socket) => {
      socketConnections += 1;
      socket.on("error", () => {});
      socket.on("data", () => socket.end("HTTP/1.0 200 OK\r\n\r\nFROM-LOCAL-LISTENER"));
    });
    await new Promise<void>((resolve) => socketServer.listen(0, "127.0.0.1", resolve));
    webSocketServer = http.createServer();
    webSocketServer.on("upgrade", (_request, socket) => {
      webSocketUpgrades += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => webSocketServer.listen(0, "127.0.0.1", resolve));

    const root = scratch("workerd");
    fs.writeFileSync(path.join(root, "superwall.json"), JSON.stringify(manifest));
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.symlinkSync(
      path.dirname(createRequire(path.join(CLI_ROOT, "package.json")).resolve("wrangler/package.json")),
      path.join(root, "node_modules", "wrangler"),
    );
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"real-workerd","private":true}');
    fs.writeFileSync(path.join(root, "wrangler.jsonc"), '{"name":"real-workerd","main":"src/worker.ts","compatibility_date":"2026-09-01"}');
    fs.writeFileSync(
      path.join(root, "src", "worker.ts"),
      WORKER((socketServer.address() as net.AddressInfo).port, (webSocketServer.address() as net.AddressInfo).port),
    );

    const bundle = await bundleWorkspace(root);
    runtime = await startMiniflare({
      root,
      module: bundle.module,
      outbound: createOutbound({
        apiOrigin: "https://api.test",
        credential: { current: async () => TOKEN, renew: async () => TOKEN },
        log: { info: (text) => logged.push(text), warn: (text) => logged.push(text) },
        declaredScopes: () => manifest.scopes,
        fetchImpl: (async (url: string, init: RequestInit) => {
          const headers = init.headers as Headers;
          apiCalls.push({ url, authorization: headers.get("authorization"), cookie: headers.get("cookie") });
          if (url.endsWith("/not-modified")) return new Response(null, { status: 304 });
          return Response.json({ data: "from the api" });
        }) as never,
      }),
    });
    server = await startDevServer({
      getManifest: () => manifest,
      runtime,
      port: 0,
      defaults: { organizationId: "1", applicationId: "2", campaignId: "3", audienceId: "4", variantIds: ["5"] },
    });
  });

  after(async () => {
    await server?.close();
    await runtime?.dispose();
    socketServer.close();
    webSocketServer.close();
  });

  test("a bundle may import cloudflare:sockets, and connect() still can't open a socket", async () => {
    for (const pathname of ["/connect", "/connect-string"]) {
      const answer = await page(pathname);
      const text = await answer.text();
      assert.equal(answer.status, 403, `${pathname}: ${text}`);
      assert.doesNotMatch(text, /LEAK|FROM-LOCAL-LISTENER/);
    }
    assert.equal(socketConnections, 0);
  });

  test("a WebSocket can't reach the machine either", async () => {
    const answer = await page("/web-socket");
    assert.equal(answer.status, 403, await answer.clone().text());
    assert.equal(webSocketUpgrades, 0);
  });

  test("fetch to an outside host is refused before it leaves", async () => {
    assert.equal(await (await page("/outside")).text(), "403");
    assert.equal(socketConnections, 0);
  });

  test("the bundle has no bindings, and the Cache API is gone before it runs", async () => {
    assert.deepEqual(await (await page("/env")).json(), { env: [], moduleEnv: [], hasCtx: false });
    assert.equal(await (await page("/caches")).text(), "undefined");
  });

  test("API calls carry the token, which the Worker never sees, and nothing the Worker set", async () => {
    apiCalls.length = 0;
    const body = (await (await page("/api")).json()) as { status: number; body: string; headers: string[] };
    assert.equal(body.status, 200);
    assert.equal(body.body, '{"data":"from the api"}');
    assert.deepEqual(apiCalls, [{ url: "https://api.test/v2/projects", authorization: `Bearer ${TOKEN}`, cookie: null }]);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(TOKEN));
    assert.doesNotMatch(logged.join("\n"), new RegExp(TOKEN));
  });

  test("a slot tied to one app is refused SQL, and an organization page isn't", async () => {
    apiCalls.length = 0;
    assert.match(await (await page("/sql", "app")).text(), /^403 .*can't run SQL/);
    assert.equal(apiCalls.length, 0);
    assert.match(await (await page("/sql", "home")).text(), /^200 /);
    assert.equal(apiCalls.length, 1);
  });

  test("a 304 from the API reaches the Worker as a 304", async () => {
    assert.equal(await (await page("/not-modified")).text(), "304");
  });

  test("a Worker's stream reaches the browser as it's written", async () => {
    const started = Date.now();
    const reader = (await page("/stream")).body!.getReader();
    const first = await reader.read();
    assert.match(Buffer.from(first.value!).toString(), /^first/);
    assert.ok(Date.now() - started < 1400, "the first chunk waited for the end of the stream");
    await reader.cancel();
  });

  test("metrics and readouts run over RPC, and thrown errors keep their message", async () => {
    const run = (route: string, body: unknown) =>
      fetch(`${server.hostOrigin}${route}`, { method: "POST", headers: { origin: server.hostOrigin }, body: JSON.stringify(body) });
    const ok = (await (await run("/__dev/metric", { entrypoint: "count", input: {} })).json()) as { series: { points: unknown[] } };
    assert.equal(ok.series.points.length, 1);
    const thrown = (await (await run("/__dev/metric", { entrypoint: "throws", input: {} })).json()) as { error: string };
    assert.match(thrown.error, /this workspace broke on purpose/);
    const missing = (await (await run("/__dev/readout", { entrypoint: "lift", input: {} })).json()) as { error: string };
    assert.match(missing.error, /no readout handler/);
  });

  test("a new bundle replaces the old one", async () => {
    await runtime.update('export default { fetch: () => new Response("updated") }');
    const answer = await runtime.fetch("http://localhost/", { method: "GET" });
    assert.equal(await answer.text(), "updated");
  });
});
