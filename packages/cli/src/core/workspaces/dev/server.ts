import { randomBytes } from "node:crypto";
import * as http from "node:http";
import { findEntrypoint, WorkspaceError, type Manifest } from "@/core/workspaces/project";
import {
  checkMetricQuery,
  readoutProblem,
  seriesProblem,
  type MetricQuery,
} from "@/core/workspaces/series";
import { buildContext, defaultRange, SLOTS, type ContextInput } from "@/core/workspaces/slots";
import {
  CONTEXT_HEADER,
  ENTRYPOINT_HEADER,
  isInternalPath,
  METRIC_LIMITS,
  READOUT_LIMITS,
  TRIGGER_HEADER,
  WORKSPACE_HEADER_PREFIX,
} from "@/core/workspaces/wire";
import { renderHostPage } from "./host-page";
import { INVOKE_PATH, type DevRuntime } from "./runtime";


interface Session {
  entrypointId: string;
  path: string;
  context: Record<string, unknown>;
  narrowed: boolean;
}

export interface DevServerOptions {
  getManifest(): Manifest;
  runtime: DevRuntime;
  port: number;
  defaults: ContextInput;
}

export interface DevServer {
  hostOrigin: string;
  frameOrigin: string;
  publish(event: { type: string; message?: string }): void;
  close(): Promise<void>;
}

const readBody = (request: http.IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const sendJson = (response: http.ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
};

const listen = (server: http.Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new WorkspaceError(`Port ${port} is already in use. Pick another with --port; dev also takes the one after it.`)
          : error,
      );
    });
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    });
  });

const closeServer = (server: http.Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

const customerPolicy = (hostOrigin: string): string =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    `frame-ancestors ${hostOrigin}`,
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");

const headerJson = (value: unknown): string =>
  JSON.stringify(value).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export const withTimeout = async <T>(work: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkspaceError(message)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const sessionTokenOf = (cookie: string | undefined, cookieName: string): string | undefined => {
  for (const part of (cookie ?? "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === cookieName) return value;
  }
  return undefined;
};

const writeBody = async (answer: Response, response: http.ServerResponse): Promise<void> => {
  if (answer.body === null) {
    response.end();
    return;
  }
  const reader = answer.body.getReader();
  response.once("close", () => void reader.cancel().catch(() => {}));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    response.write(value);
  }
  response.end();
};

export interface MetricCall extends MetricQuery {
  entrypoint: string;
  input: ContextInput;
  from?: string;
  to?: string;
  interval?: string;
  timezone?: string;
}

export interface ReadoutCall {
  entrypoint: string;
  input: ContextInput;
}

export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const { getManifest, runtime, defaults } = options;
  const sessions = new Map<string, Session>();
  const codes = new Map<string, string>();
  const subscribers = new Set<http.ServerResponse>();
  let hostOrigin = "";
  let frameOrigin = "";
  let sessionCookie = "";

  const invoke = async (kind: string, payload: unknown, timeoutMs: number): Promise<unknown> => {
    const answer = await withTimeout(
      runtime.fetch(`${frameOrigin}${INVOKE_PATH}${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      timeoutMs,
      `The ${kind} handler didn't answer within ${timeoutMs / 1000} seconds.`,
    );
    const body = (await answer.json()) as { result?: unknown; error?: string };
    if (body.error !== undefined) throw new WorkspaceError(body.error);
    return body.result;
  };

  const runMetric = async (call: MetricCall) => {
    const entrypoint = findEntrypoint(getManifest(), call.entrypoint);
    if (entrypoint.slot !== "chart.source@1") {
      throw new WorkspaceError(`\`${entrypoint.id}\` (${entrypoint.slot}) isn't a metric.`);
    }
    const filters = Object.fromEntries(
      Object.entries(call.filters ?? {}).filter(([, values]) => values.length > 0),
    );
    checkMetricQuery(entrypoint.metric, { breakdown: call.breakdown, filters });
    const range = defaultRange(30);
    const started = Date.now();
    const series = await invoke(
      "metric",
      {
        metric: entrypoint.id,
        context: buildContext(entrypoint.slot, { ...defaults, ...call.input }),
        from: new Date(call.from ?? range.from).toISOString(),
        to: new Date(call.to ?? range.to).toISOString(),
        interval: call.interval ?? "day",
        timezone: call.timezone ?? "UTC",
        breakdown: call.breakdown ?? null,
        filters,
      },
      METRIC_LIMITS.timeoutMs,
    );
    const problem = seriesProblem(series);
    if (problem) throw new WorkspaceError(problem);
    return { series, took_ms: Date.now() - started };
  };

  const runReadout = async (call: ReadoutCall) => {
    const entrypoint = findEntrypoint(getManifest(), call.entrypoint);
    if (entrypoint.slot !== "campaign.metric@1") {
      throw new WorkspaceError(`\`${entrypoint.id}\` (${entrypoint.slot}) isn't a readout.`);
    }
    const context = buildContext(entrypoint.slot, { ...defaults, ...call.input });
    const started = Date.now();
    const result = await invoke("readout", { metric: entrypoint.id, context }, READOUT_LIMITS.timeoutMs);
    const problem = readoutProblem(result, (context.variantIds ?? []) as readonly number[]);
    if (problem) throw new WorkspaceError(problem);
    return { result, took_ms: Date.now() - started };
  };

  const createSession = (call: { entrypoint: string; input: ContextInput }) => {
    const entrypoint = findEntrypoint(getManifest(), call.entrypoint);
    if (entrypoint.path === undefined) {
      throw new WorkspaceError(`\`${entrypoint.id}\` (${entrypoint.slot}) has no path to open.`);
    }
    const context = buildContext(entrypoint.slot, { ...defaults, ...call.input });
    const token = randomBytes(24).toString("hex");
    const code = randomBytes(24).toString("hex");
    sessions.set(token, {
      entrypointId: entrypoint.id,
      path: entrypoint.path,
      context,
      narrowed: "applicationId" in context,
    });
    codes.set(code, token);
    return {
      connect_url: `${frameOrigin}/__connect?code=${code}`,
      origin: frameOrigin,
      slot: entrypoint.slot,
      context,
    };
  };

  const state = () => ({
    frameOrigin,
    defaults,
    slots: SLOTS,
    manifest: getManifest(),
  });

  const allowedHost = (request: http.IncomingMessage, origin: string): boolean =>
    request.headers.host === new URL(origin).host;

  const answerHost = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    if (!allowedHost(request, hostOrigin)) return sendJson(response, 403, { error: "Open this through localhost." });
    const { pathname } = new URL(request.url ?? "/", hostOrigin);
    if (request.method === "GET" && pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(renderHostPage());
      return;
    }
    if (request.method === "GET" && pathname === "/__dev/state") return sendJson(response, 200, state());
    if (request.method === "GET" && pathname === "/__dev/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      response.write(": connected\n\n");
      subscribers.add(response);
      request.on("close", () => subscribers.delete(response));
      return;
    }
    if (request.method !== "POST") return sendJson(response, 404, { error: "Not found." });
    if (request.headers.origin !== hostOrigin) {
      return sendJson(response, 403, { error: `POSTs here need the header Origin: ${hostOrigin}.` });
    }
    try {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}") as never;
      if (pathname === "/__dev/sessions") return sendJson(response, 200, createSession(body));
      if (pathname === "/__dev/metric") return sendJson(response, 200, await runMetric(body));
      if (pathname === "/__dev/readout") return sendJson(response, 200, await runReadout(body));
    } catch (error) {
      return sendJson(response, 400, { error: (error as Error).message });
    }
    sendJson(response, 404, { error: "Not found." });
  };

  const answerFrame = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    if (!allowedHost(request, frameOrigin)) return sendJson(response, 403, { error: "Open this through localhost." });
    const url = new URL(request.url ?? "/", frameOrigin);
    if (url.pathname === "/__connect") {
      const code = url.searchParams.get("code") ?? "";
      const token = codes.get(code);
      const session = token === undefined ? undefined : sessions.get(token);
      codes.delete(code);
      if (session === undefined) return sendJson(response, 400, { error: "That link was already used." });
      response.writeHead(302, {
        location: session.path,
        "set-cookie": `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax`,
      });
      response.end();
      return;
    }
    if (isInternalPath(url.pathname)) return sendJson(response, 404, { error: "Not found." });
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    if (hasBody && request.headers.origin !== frameOrigin) {
      return sendJson(response, 403, { error: "Only this frame's own page can send this." });
    }
    const session = sessions.get(sessionTokenOf(request.headers.cookie, sessionCookie) ?? "");
    if (session === undefined) {
      return sendJson(response, 401, { error: `This frame has no session. Open it from ${hostOrigin}.` });
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (name === "cookie" || name === "host" || name.startsWith("mf-") || name.startsWith(WORKSPACE_HEADER_PREFIX)) {
        continue;
      }
      if (typeof value === "string") headers.set(name, value);
    }
    headers.set(CONTEXT_HEADER, headerJson(session.context));
    headers.set(ENTRYPOINT_HEADER, session.entrypointId);
    headers.set(TRIGGER_HEADER, "dev");
    const answer = await runtime.fetch(
      `${frameOrigin}${request.url}`,
      {
        method: request.method,
        headers,
        ...(hasBody ? { body: await readBody(request) } : {}),
      },
      { narrowed: session.narrowed },
    );
    const out = new Headers(answer.headers);
    out.delete("set-cookie");
    out.delete("access-control-allow-credentials");
    out.delete("content-encoding");
    out.delete("content-length");
    out.delete("transfer-encoding");
    for (const name of [...out.keys()]) if (name.startsWith("mf-")) out.delete(name);
    out.append("content-security-policy", customerPolicy(hostOrigin));
    out.set("x-content-type-options", "nosniff");
    out.set("referrer-policy", "same-origin");
    response.writeHead(answer.status, Object.fromEntries(out.entries()));
    await writeBody(answer, response);
  };

  const guarded =
    (answer: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>) =>
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      answer(request, response).catch((error: unknown) => {
        if (response.headersSent) {
          response.end();
          return;
        }
        sendJson(response, 500, { error: (error as Error).message });
      });
    };

  const hostServer = http.createServer(guarded(answerHost));
  const frameServer = http.createServer(guarded(answerFrame));
  const hostPort = await listen(hostServer, options.port);
  const framePort = await listen(frameServer, options.port === 0 ? 0 : options.port + 1).catch(async (error: unknown) => {
    await closeServer(hostServer);
    throw error;
  });
  hostOrigin = `http://localhost:${hostPort}`;
  frameOrigin = `http://localhost:${framePort}`;
  sessionCookie = `sw_dev_session_${framePort}`;

  return {
    hostOrigin,
    frameOrigin,
    publish(event) {
      const line = `data: ${JSON.stringify(event)}\n\n`;
      for (const subscriber of subscribers) subscriber.write(line);
    },
    async close() {
      for (const subscriber of subscribers) subscriber.end();
      await Promise.all([closeServer(hostServer), closeServer(frameServer)]);
    },
  };
}
