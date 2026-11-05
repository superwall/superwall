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
  renew(): Promise<string>;
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
    let answer = await send(target, request, body, await credential.current());
    if (answer.status === 401) answer = await send(target, request, body, await credential.renew());
    const took = Date.now() - started;
    if (answer.status === 403) {
      const text = await answer.clone().text();
      log.warn(`${label} ${answer.status} ${took}ms. Dev is read-only. ${text.slice(0, 200)}`);
    } else {
      log.info(`${label} ${answer.status} ${took}ms`);
    }
    const headers = new Headers(answer.headers);
    for (const name of STRIPPED_ANSWER_HEADERS) headers.delete(name);
    return new Response(await answer.arrayBuffer(), { status: answer.status, headers });
  };
}
