import { isWorkspaceRequestAllowed, WORKSPACE_ROUTE_REFUSAL } from "@/core/workspaces/routes";
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
  renew(rejected: string, why?: { expired?: boolean }): Promise<string>;
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
  limitedTo?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

const EXPIRED_REASON = "agent_token_expired";

const refusalOf = async (answer: Response): Promise<{ reason?: unknown; message?: unknown }> => {
  const text = await answer.clone().text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {}
  return { message: text };
};

const ORGANIZATION_QUERY = /^\/v2\/organizations\/[^/]+\/query\/?$/i;

const refuse = (status: number, message: string): Response =>
  new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json" } });

const refuseRoute = (): Response =>
  new Response(JSON.stringify({ type: "permission_error", code: "insufficient_permissions", message: WORKSPACE_ROUTE_REFUSAL }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });

const routeHint = (pathname: string, narrowed: boolean): string => {
  if (!narrowed) return "It answers the same on the real runtime.";
  if (ORGANIZATION_QUERY.test(pathname)) {
    return "A slot tied to one app can't run SQL: the organization query endpoint needs org.page@1 or a metric. It answers the same on the real runtime.";
  }
  return "This slot is tied to one app, and only reaches that app's routes. It answers the same on the real runtime, so use an org.page@1 or another route.";
};

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

export function createOutbound({ apiOrigin, credential, log, declaredScopes, limitedTo, fetchImpl = fetch }: OutboundOptions): Outbound {
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
    if (!isWorkspaceRequestAllowed(request.method, `${url.pathname}${url.search}`, caller.narrowed)) {
      log.warn(`${label} 403. ${WORKSPACE_ROUTE_REFUSAL} ${routeHint(url.pathname, caller.narrowed)}`);
      return refuseRoute();
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
      const expired = (await refusalOf(answer)).reason === EXPIRED_REASON;
      const renewed = await credential.renew(token, { expired }).catch((error: Error) => {
        log.warn(error.message);
        return undefined;
      });
      if (renewed !== undefined) answer = await send(target, request, body, renewed);
    }
    const took = Date.now() - started;
    if (answer.status === 403) {
      const { message } = await refusalOf(answer);
      const organization = limitedTo?.();
      const reach = organization === undefined ? "Dev is read-only." : `Dev's token is read-only, limited to organization ${organization} and the routes a workspace can read.`;
      log.warn(`${label} ${answer.status} ${took}ms. ${reach} ${String(message ?? "").slice(0, 200)}`.trimEnd());
    } else {
      log.info(`${label} ${answer.status} ${took}ms`);
    }
    const headers = new Headers(answer.headers);
    for (const name of STRIPPED_ANSWER_HEADERS) headers.delete(name);
    return rebuildResponse(answer, Response, headers);
  };
}
