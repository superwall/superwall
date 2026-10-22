import { NotLoggedInError } from "@/core/account/errors";
import { readSession, resolveApiHost, type Session } from "@/core/account/storage";
import { resolveAuthToken } from "@/core/account/token";

interface ApiErrorDetail {
  type?: string;
  code?: string;
  param?: string;
  docUrl?: string;
  resourceType?: string;
  resourceId?: string;
}

const BODY_SNIPPET = 200;

function parseErrorEnvelope(body: string): { message: string; detail: ApiErrorDetail } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const text = (key: string): string | undefined => {
    const value = Reflect.get(parsed, key);
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const message = text("message");
  if (message === undefined) return undefined;
  return {
    message,
    detail: {
      type: text("type"),
      code: text("code"),
      param: text("param"),
      docUrl: text("doc_url"),
      resourceType: text("resource_type"),
      resourceId: text("resource_id"),
    },
  };
}

export class ApiError extends Error {
  readonly detail: ApiErrorDetail;
  readonly request: string;
  readonly envelope: boolean;
  hint?: string;

  constructor(
    request: string,
    readonly status: number,
    readonly body?: string,
  ) {
    const envelope = body === undefined ? undefined : parseErrorEnvelope(body);
    const snippet = body?.trim().slice(0, BODY_SNIPPET);
    super(envelope?.message ?? (snippet ? `HTTP ${status} — ${snippet}` : `HTTP ${status}`));
    this.detail = envelope?.detail ?? {};
    this.request = request;
    this.envelope = envelope !== undefined;
  }
}

export class ApiUnreachableError extends Error {
  constructor(host: string, cause: unknown) {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(host);
    super(
      `Couldn't reach the Superwall API at ${host}.\n` +
        (local
          ? "  That's a local address — start the API, or unset SUPERWALL_API_HOST to use production."
          : "  Check your network or proxy, then try again."),
    );
    this.name = "ApiUnreachableError";
    this.cause = cause;
  }
}

interface RequestOptions {
  headers?: Record<string, string>;
}

export type SuperwallApi = {
  readonly org: { id?: string };
  readonly userEmail: string | undefined;
  readonly host: string;
  forOrg(id: string): SuperwallApi;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  del<T>(path: string, options?: RequestOptions): Promise<T>;
  postText(path: string, body: string): Promise<string>;
  list<T>(path: string): Promise<T[]>;
};

const PAGE_LIMIT = 50;
const GET_RETRIES = 3;
const RETRYABLE = new Set([429, 502, 503, 504]);

async function parseApiError(request: string, res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  return new ApiError(request, res.status, text);
}

function retryDelay(res: Response, retry: number): number {
  const after = Number(res.headers.get("retry-after"));
  if (Number.isFinite(after) && after >= 0 && res.headers.has("retry-after")) return after * 1000;
  return 400 * 2 ** retry;
}

export const createSuperwallApi = (initial: Session): SuperwallApi => {
  let session = initial;

  const host = (): string => resolveApiHost(session);

  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new ApiUnreachableError(host(), error);
    }
  };

  const authorized = async (): Promise<string> => {
    const resolved = await resolveAuthToken(session);
    session = resolved.session;
    return resolved.token;
  };

  const request = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> => {
    const token = await authorized();
    const attempt = () => {
      return send(`${host()}${path}`, {
        method,
        headers: {
          ...options.headers,
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    };
    let res = await attempt();
    for (
      let retry = 0;
      method === "GET" && RETRYABLE.has(res.status) && retry < GET_RETRIES;
      retry++
    ) {
      await new Promise((done) => setTimeout(done, retryDelay(res, retry)));
      res = await attempt();
    }
    if (!res.ok) throw await parseApiError(`${method} ${path}`, res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };

  const api: SuperwallApi = {
    org: {},
    get userEmail() {
      return session.userEmail;
    },
    get host() {
      return host();
    },
    forOrg: (id) => ({ ...api, org: { id }, forOrg: api.forOrg }),
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body, options),
    put: (path, body, options) => request("PUT", path, body, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    del: (path, options) => request("DELETE", path, undefined, options),
    async postText(path, body) {
      const token = await authorized();
      const res = await send(`${host()}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "text/plain",
          "content-type": "text/plain; charset=utf-8",
        },
        body,
      });
      if (!res.ok) throw await parseApiError(`POST ${path}`, res);
      return res.text();
    },
    async list<T>(path: string) {
      const out: T[] = [];
      let after: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page++) {
        const sep = path.includes("?") ? "&" : "?";
        const url = `${path}${sep}limit=100${after ? `&starting_after=${after}` : ""}`;
        const batch = await api.get<{ data: T[]; has_more?: boolean }>(url);
        out.push(...batch.data);
        if (!batch.has_more || batch.data.length === 0) break;
        const last = batch.data.at(-1);
        if (typeof last !== "object" || last === null || !("id" in last) || last.id == null) break;
        after = String(last.id);
      }
      return out;
    },
  };

  return api;
};

export const superwallApi = (): SuperwallApi => {
  const session = readSession();
  if (!session) throw new NotLoggedInError();
  return createSuperwallApi(session);
};

export function withQuery(path: string, qs: URLSearchParams | Record<string, unknown>): string {
  const params = qs instanceof URLSearchParams ? qs : new URLSearchParams();
  if (!(qs instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(qs)) {
      if (typeof value === "object" && value !== null) {
        throw new Error(`Nested -d params aren't supported on GET/DELETE (got "${key}").`);
      }
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path;
}
