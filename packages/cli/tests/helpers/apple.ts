import { readFileSync } from "node:fs";
import type { Fetch } from "@/core/apple/transport";

interface Vector {
  accountName: string;
  password: string;
  salt: string;
  iterations: number;
  secretHex: string;
  serverPublicKey: string;
  m1: string;
}

export const vector = (
  JSON.parse(
    readFileSync(new URL("../fixtures/apple/srp-vectors.json", import.meta.url), "utf8"),
  ) as Vector[]
)[0]!;

export const fixedRandom = (): Buffer => Buffer.from(vector.secretHex, "hex");

export interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

export interface FakeApple {
  fetch: Fetch;
  calls: Call[];
  called(method: string, fragment: string): Call[];
}

export interface FakeAppleOptions {
  twoFactor?: boolean;
  noTrustedDevices?: boolean;
  phones?: Array<{ id: number; pushMode?: string; numberWithDialCode: string }>;
  code?: string;
  completeStatus?: number;
  teams?: Array<{ providerId: number; publicProviderId?: string; name: string }>;
  iris?: (call: Call) => Response | undefined;
  routes?: (call: Call) => Response | undefined;
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init });

export function fakeApple(options: FakeAppleOptions = {}): FakeApple {
  const calls: Call[] = [];
  const teams = options.teams ?? [
    { providerId: 111, publicProviderId: "issuer-111", name: "Acme Inc" },
  ];
  let currentTeam = teams[0];
  const code = options.code ?? "123456";

  const respond = (call: Call): Response => {
    const override = options.routes?.(call);
    if (override) return override;
    const { method, url } = call;
    const path = new URL(url).pathname;
    const signedIn = (call.headers.get("cookie") ?? "").includes("myacinfo=ok");

    if (path === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://idmsa.apple.com/appleauth/signout?widgetKey=widget&asop=destroy-session",
        },
      });
    }
    if (path === "/appleauth/auth/signin/init") {
      return json({
        iteration: vector.iterations,
        salt: vector.salt,
        protocol: "s2k",
        b: vector.serverPublicKey,
        c: "challenge-token",
      });
    }
    if (path === "/appleauth/auth/signin" && method === "GET") {
      return new Response("", {
        status: 200,
        headers: { "x-apple-hc-bits": "8", "x-apple-hc-challenge": "hc-challenge" },
      });
    }
    if (path === "/appleauth/auth/signin/complete") {
      const m1 = (call.body as { m1?: string }).m1;
      if (m1 !== vector.m1) return json({ serviceErrors: [{ code: "-20101" }] }, { status: 401 });
      if (options.completeStatus) return json({}, { status: options.completeStatus });
      if (options.twoFactor === false) {
        return json({}, { headers: { "set-cookie": "myacinfo=ok; Domain=apple.com; Path=/" } });
      }
      return json(
        {},
        {
          status: 409,
          headers: {
            "x-apple-id-session-id": "session-1",
            scnt: "scnt-1",
            "set-cookie": "aasp=1; Path=/",
          },
        },
      );
    }
    if (path === "/appleauth/auth" && method === "GET") {
      return json({
        noTrustedDevices: options.noTrustedDevices ?? false,
        securityCode: { length: 6 },
        trustedPhoneNumbers: options.phones ?? [
          { id: 1, pushMode: "sms", numberWithDialCode: "+1 (•••) •••-••42" },
        ],
      });
    }
    if (path === "/appleauth/auth/verify/phone" && method === "PUT") return json({});
    if (path.endsWith("/securitycode") && method === "POST") {
      const sent = (call.body as { securityCode?: { code?: string } }).securityCode?.code;
      return sent === code
        ? new Response(null, { status: 204 })
        : json(
            { serviceErrors: [{ code: "-21669", message: "Incorrect verification code." }] },
            { status: 400 },
          );
    }
    if (path === "/appleauth/auth/2sv/trust") {
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": "myacinfo=ok; Domain=apple.com; Path=/" },
      });
    }
    if (path === "/olympus/v1/session" && method === "GET") {
      if (!signedIn) return json({ errors: [{ title: "Unauthenticated" }] }, { status: 401 });
      return json({
        provider: currentTeam,
        availableProviders: teams,
        user: { emailAddress: "jane@example.com" },
      });
    }
    if (path === "/olympus/v1/session" && method === "POST") {
      const id = (call.body as { provider?: { providerId?: number } }).provider?.providerId;
      currentTeam = teams.find((team) => team.providerId === id) ?? currentTeam;
      return new Response(null, { status: 200 });
    }
    if (path.startsWith("/iris/v1/")) {
      return options.iris?.(call) ?? json({ data: [] });
    }
    return json({ errors: [{ detail: `unhandled ${method} ${path}` }] }, { status: 404 });
  };

  const fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? "GET",
      url: String(input),
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  }) as Fetch;

  return {
    fetch,
    calls,
    called: (method, fragment) =>
      calls.filter((call) => call.method === method && call.url.includes(fragment)),
  };
}

export { json as jsonResponse };
