import { NotLoggedInError } from "@/core/account/errors";
import { readSession, resolveApiHost, type Session } from "@/core/account/storage";
import { resolveAuthToken } from "@/core/account/token";
import { USER_AGENT } from "@/environment";

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

// Codes for a connection that opened and then dropped. Anything else (DNS, refused, timed out) never got through.
const DROPPED_CODES: ReadonlySet<string> = new Set([
  "EPIPE",
  "ECONNRESET",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);
const DROPPED_MESSAGE = /other side closed|socket hang up|socket connection was closed/i;

interface FetchFailure {
  code?: string;
  message?: string;
}

// Node's fetch throws `TypeError: fetch failed` and keeps the reason in `cause` (sometimes an AggregateError
// of one per address). Bun puts the code on the error itself. Take the deepest error that says something.
function fetchFailureOf(error: unknown): FetchFailure {
  let found: FetchFailure = {};
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const code = Reflect.get(current, "code");
    const message = Reflect.get(current, "message");
    const useful = typeof message === "string" && message !== "" && message !== "fetch failed" ? message : undefined;
    if (typeof code === "string" && code !== "") found = { code, message: useful };
    else if (found.code === undefined && useful !== undefined) found = { message: useful };
    const errors = Reflect.get(current, "errors");
    current = Reflect.get(current, "cause") ?? (Array.isArray(errors) ? errors[0] : undefined);
  }
  return found;
}

const failureLabel = ({ code, message }: FetchFailure): string | undefined => {
  if (code === undefined) return message;
  return message === undefined || message.includes(code) ? code : `${code}: ${message}`;
};

interface Deadline {
  ms: number;
  write: boolean;
}

const isTimeout = (error: unknown): boolean => error instanceof Error && error.name === "TimeoutError";

export class ApiUnreachableError extends Error {
  /** The connection opened and then dropped, so the API may or may not have got the request. */
  readonly dropped: boolean;
  /** The API didn't answer before the deadline, so it may or may not have got the request. */
  readonly timedOut: boolean;
  readonly code?: string;

  constructor(host: string, cause: unknown, deadline?: Deadline) {
    if (deadline !== undefined) {
      super(
        `The Superwall API at ${host} didn't answer within ${deadline.ms / 1000}s.\n` +
          (deadline.write
            ? "  The change may or may not have been applied. Check before sending it again."
            : "  Try again."),
      );
      this.name = "ApiUnreachableError";
      this.cause = cause;
      this.dropped = false;
      this.timedOut = true;
      return;
    }
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(host);
    const failure = fetchFailureOf(cause);
    const dropped =
      (failure.code !== undefined && DROPPED_CODES.has(failure.code)) || DROPPED_MESSAGE.test(failure.message ?? "");
    const label = failureLabel(failure);
    const why = label === undefined ? "" : ` (${label})`;
    super(
      dropped
        ? `Lost the connection ${failure.code === "EPIPE" ? "while sending to" : "to"} the Superwall API at ${host}${why}.\n` +
            "  It closed before the request finished. Try again."
        : `Couldn't reach the Superwall API at ${host}${why}.\n` +
            (local
              ? "  That's a local address — start the API, or unset SUPERWALL_API_HOST to use production."
              : "  Check your network or proxy, then try again."),
    );
    this.name = "ApiUnreachableError";
    this.cause = cause;
    this.dropped = dropped;
    this.timedOut = false;
    if (failure.code !== undefined) this.code = failure.code;
  }
}

interface RequestOptions {
  headers?: Record<string, string>;
  /**
   * Sending this request twice does what sending it once does. A connection that drops mid-request is
   * then retried, three attempts in all, since nobody can tell whether the API got it.
   */
  idempotent?: boolean;
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
const DROPPED_ATTEMPTS = 3;
const DROPPED_BACKOFF_MS = 250;
const REQUEST_TIMEOUT_MS = 60_000;
const TEXT_TIMEOUT_MS = 300_000;

async function parseApiError(request: string, res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  return new ApiError(request, res.status, text);
}

// Fetch joins differently cased duplicates ("a, b"), so a caller's own User-Agent must replace ours by name.
const namesUserAgent = (headers: Record<string, string> | undefined): boolean =>
  Object.keys(headers ?? {}).some((name) => name.toLowerCase() === "user-agent");

function retryDelay(res: Response, retry: number): number {
  const after = Number(res.headers.get("retry-after"));
  if (Number.isFinite(after) && after >= 0 && res.headers.has("retry-after")) return after * 1000;
  return 400 * 2 ** retry;
}

export const createSuperwallApi = (
  initial: Session,
  {
    userAgent = USER_AGENT(),
    timeoutMs = REQUEST_TIMEOUT_MS,
    textTimeoutMs = TEXT_TIMEOUT_MS,
  }: { userAgent?: string; timeoutMs?: number; textTimeoutMs?: number } = {},
): SuperwallApi => {
  let session = initial;

  const host = (): string => resolveApiHost(session);

  const send = async (url: string, init: RequestInit, ms = timeoutMs): Promise<Response> => {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    } catch (error) {
      if (!isTimeout(error)) throw new ApiUnreachableError(host(), error);
      throw new ApiUnreachableError(host(), error, { ms, write: init.method !== "GET" });
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
    const once = () => {
      return send(`${host()}${path}`, {
        method,
        headers: {
          ...(namesUserAgent(options.headers) ? {} : { "user-agent": userAgent }),
          ...options.headers,
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    };
    // Only a dropped connection is retried here, and only when sending twice is safe: an HTTP answer,
    // 4xx included, is the API's verdict, and a request that never connected won't connect by waiting.
    const attempt = async (): Promise<Response> => {
      for (let tried = 1; ; tried++) {
        try {
          return await once();
        } catch (error) {
          const again = options.idempotent === true && error instanceof ApiUnreachableError && error.dropped;
          if (!again || tried >= DROPPED_ATTEMPTS) throw error;
          await new Promise((done) => setTimeout(done, DROPPED_BACKOFF_MS * 2 ** (tried - 1)));
        }
      }
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
      const init = {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": userAgent,
          accept: "text/plain",
          "content-type": "text/plain; charset=utf-8",
        },
        body,
      };
      const res = await send(`${host()}${path}`, init, textTimeoutMs);
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
