import { scopeForRoute } from "@/core/workspaces/scopes";
import { API_HOST, PLATFORM_HOST } from "@/core/workspaces/wire";
import type { Outbound } from "./runtime";

const FORWARDED_HEADERS = [
  "accept",
  "accept-encoding",
  "accept-language",
  "content-type",
  "if-match",
  "if-none-match",
  "idempotency-key",
  "user-agent",
];

export interface AgentCredential {
  current(): Promise<string>;
  renew(rejected: string): Promise<string>;
}

export interface OutboundLog {
  info(text: string): void;
  warn(text: string): void;
}

export interface OutboundOptions {
  apiOrigin: string;
  credential: AgentCredential;
  log: OutboundLog;
  declaredScopes: () => readonly string[];
  fetchImpl?: typeof fetch;
}

const ORGANIZATION_QUERY = /^\/v2\/organizations\/[^/]+\/query\/?$/i;
const NARROWED_QUERY_MESSAGE =
  "A slot tied to one app can't run SQL: the organization query endpoint needs org.page@1 or a metric. It answers 403 on the real runtime too.";

const refuse = (status: number, message: string): Response =>
  new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json" } });

const STRIPPED_ANSWER_HEADERS = ["set-cookie", "content-encoding", "content-length", "transfer-encoding"];
const BODYLESS_STATUSES = new Set([101, 204, 205, 304]);

export function rebuildResponse(
  answer: Response,
  ResponseClass: typeof Response = Response,
  headers: Headers = answer.headers,
): Response {
  const body = BODYLESS_STATUSES.has(answer.status) ? null : answer.body;
  return new ResponseClass(body, { status: answer.status, headers });
}

export function createOutbound({ apiOrigin, credential, log, declaredScopes, fetchImpl = fetch }: OutboundOptions): Outbound {
  const warnedScopes = new Set<string>();
  const send = async (url: string, request: Request, body: ArrayBuffer | undefined, token: string) => {
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set("authorization", `Bearer ${token}`);
    return fetchImpl(url, { method: request.method, headers, redirect: "manual", ...(body ? { body } : {}) });
  };

  return async (request, caller) => {
    const url = new URL(request.url);
    if (url.hostname === PLATFORM_HOST) {
      log.warn("Workspace storage, jobs and logs aren't available in dev.");
      return refuse(501, "Workspace storage, jobs and logs aren't available in dev.");
    }
    if (url.hostname !== API_HOST) {
      log.warn(`Refused ${request.method} ${url.origin}: dev runs like a draft, with no outside hosts.`);
      return refuse(403, `Dev runs like a draft, with no outside hosts: ${url.hostname} isn't reachable.`);
    }

    const label = `${request.method} ${url.pathname}`;
    if (caller.narrowed && ORGANIZATION_QUERY.test(url.pathname)) {
      log.warn(`${label} refused. ${NARROWED_QUERY_MESSAGE}`);
      return refuse(403, NARROWED_QUERY_MESSAGE);
    }
    const scope = scopeForRoute(request.method, url.pathname);
    if (scope !== undefined && !declaredScopes().includes(scope) && !warnedScopes.has(scope)) {
      warnedScopes.add(scope);
      log.warn(`${label} needs ${scope}, which superwall.json doesn't declare. It answers 403 on the real runtime; add it to scopes.`);
    }
    const target = `${apiOrigin}${url.pathname}${url.search}`;
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const started = Date.now();
    const token = await credential.current();
    let answer = await send(target, request, body, token);
    if (answer.status === 401) {
      const renewed = await credential.renew(token).catch((error: Error) => {
        log.warn(error.message);
        return undefined;
      });
      if (renewed !== undefined) answer = await send(target, request, body, renewed);
    }
    const took = Date.now() - started;
    if (answer.status === 403) {
      const text = await answer.clone().text();
      log.warn(`${label} ${answer.status} ${took}ms. Dev is read-only. ${text.slice(0, 200)}`);
    } else {
      log.info(`${label} ${answer.status} ${took}ms`);
    }
    const headers = new Headers(answer.headers);
    for (const name of STRIPPED_ANSWER_HEADERS) headers.delete(name);
    return rebuildResponse(answer, Response, headers);
  };
}
