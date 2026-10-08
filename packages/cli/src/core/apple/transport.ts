import { VERSION } from "@/environment";
import type { CookieJar } from "./cookies";

export type Fetch = typeof fetch;

export interface AppleResponse {
  status: number;
  headers: Headers;
  body: string;
}

export interface AppleRequest {
  headers?: Record<string, string>;
  body?: unknown;
}

export interface Transport {
  send(method: string, url: string, request?: AppleRequest): Promise<AppleResponse>;
}

const MAX_REDIRECTS = 5;

export class AppleUnreachableError extends Error {
  constructor(cause: unknown) {
    super("Couldn't reach Apple. Check your network or proxy, then try again.");
    this.name = "AppleUnreachableError";
    this.cause = cause;
  }
}

export function createTransport(jar: CookieJar, doFetch: Fetch = fetch): Transport {
  return {
    async send(method, url, request = {}) {
      let target = new URL(url);
      let verb = method;
      let body = request.body === undefined ? undefined : JSON.stringify(request.body);
      for (let hop = 0; ; hop++) {
        const cookie = jar.header(target);
        let response: Response;
        try {
          response = await doFetch(target, {
            method: verb,
            redirect: "manual",
            headers: {
              accept: "application/json",
              "user-agent": `superwall-cli/${VERSION}`,
              ...(body === undefined ? {} : { "content-type": "application/json" }),
              ...request.headers,
              ...(cookie ? { cookie } : {}),
            },
            ...(body === undefined ? {} : { body }),
          });
        } catch (error) {
          throw new AppleUnreachableError(error);
        }
        jar.store(target, response.headers.getSetCookie());
        const location = response.headers.get("location");
        const redirected = response.status >= 300 && response.status < 400 && location;
        if (!redirected || hop >= MAX_REDIRECTS) {
          return { status: response.status, headers: response.headers, body: await response.text() };
        }
        target = new URL(location, target);
        if (response.status !== 307 && response.status !== 308) {
          verb = "GET";
          body = undefined;
        }
      }
    },
  };
}

export function parseJson(body: string): unknown {
  if (body.trim() === "") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function textField(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === "string" && found.trim() !== "" ? found.trim() : undefined;
}

export function listField(value: unknown, key: string): unknown[] {
  const found = field(value, key);
  return Array.isArray(found) ? found : [];
}
