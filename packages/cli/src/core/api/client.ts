import { API_HOST } from "@/constants";
import { loadSession, saveSession, type Session } from "@/core/auth/storage";
import { resolveAuthToken } from "@/core/auth/token";
import { NotLoggedInError } from "@/core/auth/errors";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
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

export class SuperwallApi {
  private constructor(private session: Session) {}

  static of(session: Session): SuperwallApi {
    return new SuperwallApi(session);
  }

  static fromSession(): SuperwallApi {
    const session = loadSession();
    if (!session) throw new NotLoggedInError();
    return new SuperwallApi(session);
  }

  get org(): { id?: string; name?: string; count: number } {
    // SUPERWALL_ORG_ID overrides the session, the same way SUPERWALL_API_HOST
    // does: pointing at a local API means the session's org id (from the
    // hosted account) names an organization that host has never heard of.
    const override = process.env.SUPERWALL_ORG_ID;
    return {
      id: override ?? this.session.orgId,
      name: override ? undefined : this.session.orgName,
      count: this.session.orgCount ?? 1,
    };
  }
  get userEmail(): string | undefined {
    return this.session.userEmail;
  }

  /** Persists the org so it's picked at most once per login. */
  setOrg(org: { id: string; name?: string }): void {
    this.session = { ...this.session, orgId: org.id, orgName: org.name };
    saveSession(this.session);
  }

  private base(): string {
    // An explicit env override beats the stored session host — local
    // platform development points every command at a dev API without
    // re-logging-in (project .env files are loaded by the superwall bin).
    return process.env.SUPERWALL_API_HOST ?? this.session.host ?? API_HOST;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { token, session } = await resolveAuthToken(this.session);
    this.session = session;
    const res = await this.fetch(`${this.base()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(`${method} ${path} → HTTP ${res.status}`, res.status, text);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      // Node reports every connection failure as a bare "fetch failed".
      throw new ApiUnreachableError(this.base(), error);
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }
  del<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  async postText(path: string, body: string): Promise<string> {
    const { token, session } = await resolveAuthToken(this.session);
    this.session = session;
    const res = await this.fetch(`${this.base()}${path}`, {
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
      throw new ApiError(`POST ${path} → HTTP ${res.status}`, res.status, text);
    }
    return res.text();
  }

  // The API caps `limit` at 100.
  async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    for (let i = 0; i < 50; i++) {
      const sep = path.includes("?") ? "&" : "?";
      const url = `${path}${sep}limit=100${after ? `&starting_after=${after}` : ""}`;
      const page = await this.get<{ data: T[]; has_more?: boolean }>(url);
      out.push(...page.data);
      if (!page.has_more || page.data.length === 0) break;
      const last = page.data[page.data.length - 1] as { id?: string | number };
      if (last?.id == null) break;
      after = String(last.id);
    }
    return out;
  }
}
