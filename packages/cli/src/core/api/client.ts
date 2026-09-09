import { API_HOST } from "@/environment";
import { loadSession, saveSession, type Session } from "@/core/auth/storage";
import { resolveAuthToken } from "@/core/auth/token";
import { NotLoggedInError } from "@/core/auth/errors";

export interface ApiErrorDetail {
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

export { NotLoggedInError } from "@/core/auth/errors";

export interface RequestOptions {
  headers?: Record<string, string>;
}

export type SuperwallApi = {
  readonly org: { id?: string; name?: string; count: number };
  readonly userEmail: string | undefined;
  readonly host: string;
  setOrg(org: { id: string; name?: string }): void;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  del<T>(path: string, options?: RequestOptions): Promise<T>;
  postText(path: string, body: string): Promise<string>;
  list<T>(path: string): Promise<T[]>;
};

const PAGE_LIMIT = 50;

export const createSuperwallApi = (initial: Session): SuperwallApi => {
  let session = initial;

  const host = (): string => process.env.SUPERWALL_API_HOST ?? session.host ?? API_HOST();

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
    const res = await send(`${host()}${path}`, {
      method,
      headers: {
        ...options.headers,
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(`${method} ${path}`, res.status, text);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };

  const api: SuperwallApi = {
    get org() {
      const override = process.env.SUPERWALL_ORG_ID;
      return {
        id: override ?? session.orgId,
        name: override ? undefined : session.orgName,
        count: session.orgCount ?? 1,
      };
    },
    get userEmail() {
      return session.userEmail;
    },
    get host() {
      return host();
    },
    setOrg(org) {
      session = { ...session, orgId: org.id, orgName: org.name };
      saveSession(session);
    },
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
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ApiError(`POST ${path}`, res.status, text);
      }
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
        const last = batch.data[batch.data.length - 1] as { id?: string | number };
        if (last?.id == null) break;
        after = String(last.id);
      }
      return out;
    },
  };

  return api;
};

export const superwallApi = (): SuperwallApi => {
  const session = loadSession();
  if (!session) throw new NotLoggedInError();
  return createSuperwallApi(session);
};
