import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import type { CallerScope, DevRuntime } from "@/core/workspaces/dev/runtime";
import { startDevServer, withTimeout, type DevServer } from "@/core/workspaces/dev/server";
import type { Manifest } from "@/core/workspaces/project";
import { MANIFEST } from "../fixture";

const servers: DevServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

type Handler = (url: URL, init: RequestInit, caller?: CallerScope) => Response | Promise<Response>;

const JSON_OK = (result: unknown) => Response.json({ result });

async function start(handler: Handler = () => new Response("hello"), manifest: Manifest = MANIFEST) {
  const seen: { url: URL; init: RequestInit; caller?: CallerScope }[] = [];
  const runtime: DevRuntime = {
    fetch: async (url, init, caller) => {
      const parsed = new URL(url);
      seen.push({ url: parsed, init, caller });
      return handler(parsed, init, caller);
    },
    update: async () => {},
    dispose: async () => {},
  };
  const server = await startDevServer({
    getManifest: () => manifest,
    runtime,
    port: 0,
    defaults: { organizationId: "1", applicationId: "2" },
  });
  servers.push(server);
  return { server, seen };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { origin: new URL(url).origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function connect(server: DevServer, entrypoint = "home", input: unknown = {}) {
  const session = (await (await post(`${server.hostOrigin}/__dev/sessions`, { entrypoint, input })).json()) as {
    connect_url: string;
    origin: string;
    context: unknown;
  };
  const answer = await fetch(session.connect_url, { redirect: "manual" });
  const cookie = answer.headers.get("set-cookie")!.split(";")[0]!;
  return { session, answer, cookie };
}

test("the host serves its page and state on one origin and the frame on another", async () => {
  const { server } = await start();
  assert.notEqual(server.hostOrigin, server.frameOrigin);
  const page = await fetch(server.hostOrigin);
  assert.match(await page.text(), /superwall-workspace@1/);
  const state = (await (await fetch(`${server.hostOrigin}/__dev/state`)).json()) as { frameOrigin: string; manifest: Manifest };
  assert.equal(state.frameOrigin, server.frameOrigin);
  assert.equal(state.manifest.name, MANIFEST.name);
});

test("a session binds its context; the link works once and lands on the entrypoint's path", async () => {
  const { server } = await start();
  const { session, answer, cookie } = await connect(server);
  assert.deepEqual(session.context, { organizationId: 1 });
  assert.equal(answer.status, 302);
  assert.equal(answer.headers.get("location"), "/home");
  assert.match(answer.headers.get("set-cookie")!, /HttpOnly/);
  assert.ok(cookie.startsWith(`sw_dev_session_${new URL(server.frameOrigin).port}=`));
  const again = await fetch(session.connect_url, { redirect: "manual" });
  assert.equal(again.status, 400);
});

test("frame requests carry the session's context and lose everything forged, as on the platform", async () => {
  const { server, seen } = await start(
    () => new Response("hi", { headers: { "set-cookie": "x=y", "mf-content-encoding": "gzip", "access-control-allow-credentials": "true" } }),
  );
  const { cookie } = await connect(server);
  const answer = await fetch(`${server.frameOrigin}/home?a=1`, {
    headers: { cookie, "x-superwall-workspace-context": "forged", "x-superwall-workspace-other": "forged", "x-custom": "kept" },
  });
  assert.equal(await answer.text(), "hi");
  const sent = seen[0]!;
  assert.equal(sent.url.pathname + sent.url.search, "/home?a=1");
  const headers = sent.init.headers as Headers;
  assert.equal(headers.get("x-superwall-workspace-context"), '{"organizationId":1}');
  assert.equal(headers.get("x-superwall-workspace-entrypoint"), "home");
  assert.equal(headers.get("x-superwall-workspace-trigger"), "dev");
  assert.equal(headers.get("x-superwall-workspace-other"), null);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("x-custom"), "kept");
  assert.equal(answer.headers.get("set-cookie"), null);
  assert.equal(answer.headers.get("mf-content-encoding"), null);
  assert.equal(answer.headers.get("access-control-allow-credentials"), null);
  assert.match(answer.headers.get("content-security-policy")!, new RegExp(`frame-ancestors ${server.hostOrigin}`));
  assert.equal(answer.headers.get("x-content-type-options"), "nosniff");
});

test("a frame with an app in its context is narrowed to it; an org page and a metric aren't", async () => {
  const { server, seen } = await start((url) => (url.pathname.startsWith("/__sw/") ? Response.json({ result: { points: [] } }) : new Response("hi")));
  const org = await connect(server, "home");
  await fetch(`${server.frameOrigin}/home`, { headers: { cookie: org.cookie } });
  assert.deepEqual(seen.at(-1)!.caller, { narrowed: false });
  const panel = await connect(server, "panel", { appUserId: "alice" });
  await fetch(`${server.frameOrigin}/panel`, { headers: { cookie: panel.cookie } });
  assert.deepEqual(seen.at(-1)!.caller, { narrowed: true });
  await post(`${server.hostOrigin}/__dev/metric`, { entrypoint: "count", input: {} });
  assert.equal(seen.at(-1)!.caller, undefined);
});

test("non-ASCII context survives the header", async () => {
  const { server, seen } = await start();
  const { cookie } = await connect(server, "panel", { appUserId: "zoë" });
  await fetch(`${server.frameOrigin}/panel`, { headers: { cookie } });
  const header = (seen[0]!.init.headers as Headers).get("x-superwall-workspace-context")!;
  assert.equal(JSON.parse(header).appUserId, "zoë");
  assert.match(header, /\\u00eb/);
});

test("a frame POST from the frame reaches the worker with its body", async () => {
  const { server, seen } = await start();
  const { cookie } = await connect(server);
  await fetch(`${server.frameOrigin}/save`, { method: "POST", headers: { cookie, origin: server.frameOrigin }, body: "payload" });
  assert.equal(seen[0]!.init.method, "POST");
  assert.equal(Buffer.from(seen[0]!.init.body as Buffer).toString(), "payload");
});

test("the frame refuses a missing session, internal paths and other hosts", async () => {
  const { server, seen } = await start();
  assert.equal((await fetch(`${server.frameOrigin}/home`)).status, 401);
  const { cookie } = await connect(server);
  for (const path of ["/__sw/invoke/metric", "/__SW/x", "/%5F%5Fsw/x"]) {
    assert.equal((await fetch(`${server.frameOrigin}${path}`, { headers: { cookie } })).status, 404, path);
  }
  assert.equal(seen.length, 0);
  assert.equal((await fetch(`${server.frameOrigin}/__connect`, { redirect: "manual" })).status, 400);
});

const statusWithHost = (origin: string, host: string, method = "GET") =>
  new Promise<number>((resolve, reject) => {
    const request = http.request(origin, { method, headers: { host } }, (response) => {
      response.resume();
      resolve(response.statusCode!);
    });
    request.on("error", reject);
    request.end();
  });

test("another Host header is refused on both servers, whatever the method", async () => {
  const { server, seen } = await start();
  for (const origin of [server.hostOrigin, server.frameOrigin]) {
    for (const method of ["GET", "POST"]) {
      assert.equal(await statusWithHost(origin, "evil.example", method), 403, `${method} ${origin}`);
    }
  }
  assert.equal(seen.length, 0);
});

test("the host takes a POST only from its own origin: a missing Origin is refused too", async () => {
  const { server, seen } = await start((url) => (url.pathname.startsWith("/__sw/") ? Response.json({ result: { points: [] } }) : new Response()));
  const send = (route: string, headers: Record<string, string>) =>
    fetch(`${server.hostOrigin}${route}`, { method: "POST", headers, body: JSON.stringify({ entrypoint: route.endsWith("metric") ? "count" : "home", input: {} }) });
  for (const route of ["/__dev/sessions", "/__dev/metric", "/__dev/readout"]) {
    assert.equal((await send(route, {})).status, 403, `${route} with no Origin`);
    assert.equal((await send(route, { origin: "https://evil.example" })).status, 403, `${route} from elsewhere`);
    assert.equal((await send(route, { origin: server.frameOrigin })).status, 403, `${route} from the frame`);
  }
  assert.equal(seen.length, 0);
  assert.equal((await send("/__dev/metric", { origin: server.hostOrigin })).status, 200);
  assert.equal((await post(`${server.hostOrigin}/__dev/nothing`, {})).status, 404);
  assert.equal((await fetch(`${server.hostOrigin}/nothing`)).status, 404);
  const broken = await fetch(`${server.hostOrigin}/__dev/metric`, { method: "POST", headers: { origin: server.hostOrigin }, body: "{nope" });
  assert.equal(broken.status, 400);
});

test("the frame takes anything but GET and HEAD only from its own origin", async () => {
  const { server, seen } = await start();
  const { cookie } = await connect(server);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const send = (headers: Record<string, string>) => fetch(`${server.frameOrigin}/save`, { method, headers: { cookie, ...headers }, body: "x" });
    assert.equal((await send({})).status, 403, `${method} with no Origin`);
    assert.equal((await send({ origin: "https://evil.example" })).status, 403, `${method} from elsewhere`);
    assert.equal((await send({ origin: server.hostOrigin })).status, 403, `${method} from the dev page`);
  }
  assert.equal(seen.length, 0);
  assert.equal((await fetch(`${server.frameOrigin}/save`, { method: "POST", headers: { cookie, origin: server.frameOrigin }, body: "x" })).status, 200);
  assert.equal((await fetch(`${server.frameOrigin}/`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${server.frameOrigin}/`, { method: "HEAD", headers: { cookie } })).status, 200);
});

test("two dev servers keep their sessions apart, though cookies ignore ports", async () => {
  const first = await start();
  const second = await start();
  const a = await connect(first.server);
  const b = await connect(second.server);
  assert.notEqual(a.cookie.split("=")[0], b.cookie.split("=")[0]);
  const both = `${a.cookie}; ${b.cookie}`;
  assert.equal((await fetch(`${first.server.frameOrigin}/home`, { headers: { cookie: both } })).status, 200);
  assert.equal((await fetch(`${second.server.frameOrigin}/home`, { headers: { cookie: both } })).status, 200);
  assert.equal((await fetch(`${second.server.frameOrigin}/home`, { headers: { cookie: a.cookie } })).status, 401);
});

test("a busy port says so plainly, and a busy frame port leaves nothing listening", async () => {
  const blocker = http.createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const busy = (blocker.address() as AddressInfo).port;
  try {
    const options = { getManifest: () => MANIFEST, runtime: {} as DevRuntime, defaults: {} };
    await assert.rejects(startDevServer({ ...options, port: busy }), new RegExp(`Port ${busy} is already in use.*--port`));
    await assert.rejects(startDevServer({ ...options, port: busy - 1 }), new RegExp(`Port ${busy} is already in use`));
    const probe = http.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(busy - 1, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("mf-* request headers never reach miniflare", async () => {
  const { server, seen } = await start();
  const { cookie } = await connect(server);
  await fetch(`${server.frameOrigin}/home`, { headers: { cookie, "mf-original-url": "http://evil/", "mf-cf-blob": "{}", "x-kept": "1" } });
  const headers = seen[0]!.init.headers as Headers;
  assert.equal(headers.get("mf-original-url"), null);
  assert.equal(headers.get("mf-cf-blob"), null);
  assert.equal(headers.get("x-kept"), "1");
});

test("--context reaches metrics and readouts, on top of the organization and app", async () => {
  let sent: any;
  const runtime: DevRuntime = {
    fetch: async (_url, init) => {
      sent = JSON.parse(init.body as string);
      return Response.json({ result: { points: [], variants: [] } });
    },
    update: async () => {},
    dispose: async () => {},
  };
  const server = await startDevServer({
    getManifest: () => MANIFEST,
    runtime,
    port: 0,
    defaults: { organizationId: "1", applicationId: "2", context: '{"custom":true}' },
  });
  servers.push(server);
  assert.equal((await post(`${server.hostOrigin}/__dev/metric`, { entrypoint: "count", input: {} })).status, 200);
  assert.deepEqual(sent.context, { organizationId: 1, applicationId: 2, custom: true });
  assert.equal((await post(`${server.hostOrigin}/__dev/readout`, { entrypoint: "lift", input: {} })).status, 200);
  assert.deepEqual(sent.context, { organizationId: 1, applicationId: 2, custom: true });
});

test("sessions refuse headless entrypoints, unknown ones and missing context", async () => {
  const { server } = await start();
  const message = async (body: unknown) => {
    const answer = await post(`${server.hostOrigin}/__dev/sessions`, body);
    assert.equal(answer.status, 400);
    return ((await answer.json()) as { error: string }).error;
  };
  assert.match(await message({ entrypoint: "count", input: {} }), /has no path/);
  assert.match(await message({ entrypoint: "nope", input: {} }), /No entrypoint named/);
  assert.match(await message({ entrypoint: "panel", input: {} }), /a user \(--user\)/);
});

test("a metric gets the same request the platform sends, in UTC", async () => {
  const series = { points: [{ t: "2026-10-01T00:00:00Z", value: 1, breakdown: "APP_STORE" }] };
  let sent: any;
  const { server, seen } = await start((_, init) => {
    sent = JSON.parse(init.body as string);
    return JSON_OK(series);
  });
  const answer = await post(`${server.hostOrigin}/__dev/metric`, {
    entrypoint: "count",
    input: {},
    from: "2026-10-01T00:00:00+02:00",
    to: "2026-10-02T00:00:00Z",
    interval: "week",
    breakdown: "store",
    filters: { store: ["APP_STORE"], empty: [] },
    timezone: "Europe/Paris",
  });
  const body = (await answer.json()) as { series: unknown; took_ms: number };
  assert.deepEqual(body.series, series);
  assert.equal(seen[0]!.url.pathname, "/__sw/invoke/metric");
  assert.deepEqual(sent, {
    metric: "count",
    context: { organizationId: 1, applicationId: 2 },
    from: "2026-09-30T22:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
    interval: "week",
    timezone: "Europe/Paris",
    breakdown: "store",
    filters: { store: ["APP_STORE"] },
  });
});

test("a metric defaults to 30 days by day, and its problems come back as errors", async () => {
  let reply: unknown = { points: [] };
  let sent: any;
  const { server } = await start((_, init) => {
    sent = JSON.parse(init.body as string);
    return Response.json(reply as object);
  });
  const message = async (body: unknown) => {
    const answer = await post(`${server.hostOrigin}/__dev/metric`, body);
    return answer.status === 200 ? "ok" : ((await answer.json()) as { error: string }).error;
  };
  reply = { result: { points: [] } };
  assert.equal(await message({ entrypoint: "count", input: {} }), "ok");
  assert.equal(sent.interval, "day");
  assert.equal(sent.timezone, "UTC");
  assert.equal(sent.breakdown, null);
  assert.deepEqual(sent.filters, {});
  reply = { result: { points: [{ t: "bad", value: 1 }] } };
  assert.match(await message({ entrypoint: "count", input: {} }), /ISO 8601/);
  reply = { error: "This workspace has no metric handler." };
  assert.match(await message({ entrypoint: "count", input: {} }), /no metric handler/);
  assert.match(await message({ entrypoint: "home", input: {} }), /isn't a metric/);
  assert.match(await message({ entrypoint: "count", input: {}, breakdown: "plan" }), /not a breakdown/);
  assert.match(await message({ entrypoint: "count", input: { applicationId: "x" } }), /positive number/);
});

test("a handler past its time limit fails with what it was doing", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5, "too slow"), /too slow/);
  assert.equal(await withTimeout(Promise.resolve("done"), 1000, "too slow"), "done");
});

test("a readout runs for its audience and is checked", async () => {
  let reply: unknown = { variants: [{ variantId: 5, value: 1 }] };
  let sent: any;
  const { server, seen } = await start((_, init) => {
    sent = JSON.parse(init.body as string);
    return JSON_OK(reply);
  });
  const input = { campaignId: "3", audienceId: "4", variantIds: ["5"] };
  const answer = await post(`${server.hostOrigin}/__dev/readout`, { entrypoint: "lift", input });
  assert.equal(answer.status, 200);
  assert.equal(seen[0]!.url.pathname, "/__sw/invoke/readout");
  assert.deepEqual(sent, {
    metric: "lift",
    context: { organizationId: 1, applicationId: 2, campaignId: 3, audienceId: 4, variantIds: [5], environment: "PRODUCTION" },
  });
  reply = { variants: [{ variantId: 9, value: 1 }] };
  const wrong = await post(`${server.hostOrigin}/__dev/readout`, { entrypoint: "lift", input });
  assert.match(((await wrong.json()) as { error: string }).error, /isn't one of/);
  const notReadout = await post(`${server.hostOrigin}/__dev/readout`, { entrypoint: "count", input });
  assert.match(((await notReadout.json()) as { error: string }).error, /isn't a readout/);
});

test("rebuilds reach the page as events", async () => {
  const { server } = await start();
  const stream = await fetch(`${server.hostOrigin}/__dev/events`);
  const reader = stream.body!.getReader();
  await reader.read();
  server.publish({ type: "reload" });
  const { value } = await reader.read();
  assert.match(Buffer.from(value!).toString(), /"type":"reload"/);
  await reader.cancel();
});

test("a worker that throws answers 500, not a hang", async () => {
  const { server } = await start(() => {
    throw new Error("boom");
  });
  const { cookie } = await connect(server);
  const answer = await fetch(`${server.frameOrigin}/home`, { headers: { cookie } });
  assert.equal(answer.status, 500);
  assert.match(((await answer.json()) as { error: string }).error, /boom/);
});
