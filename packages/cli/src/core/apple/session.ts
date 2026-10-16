import { createCookieJar, type StoredCookie } from "./cookies";
import { mintHashcash } from "./hashcash";
import { createEphemeral, createProof, type PasswordProtocol } from "./srp";
import {
  AppleUnreachableError,
  createTransport,
  field,
  listField,
  parseJson,
  textField,
  type AppleResponse,
  type Fetch,
} from "./transport";

const AUTH_URL = "https://idmsa.apple.com/appleauth/auth";
export const ASC_URL = "https://appstoreconnect.apple.com";

export type AppleErrorKind =
  | "credentials"
  | "account-action"
  | "verification"
  | "forbidden"
  | "request";

export class AppleError extends Error {
  constructor(
    readonly kind: AppleErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AppleError";
  }
}

export interface AppleTeam {
  id: number;
  issuerId?: string;
  name: string;
}

export interface VerificationChallenge {
  method: "device" | "sms" | "voice";
  destination?: string;
  codeLength: number;
}

interface Factor {
  method: "device" | "phone";
  phoneId?: number;
  phoneMode?: string;
  destination?: string;
  codeLength: number;
}

export interface PendingVerification {
  appleId: string;
  serviceKey: string;
  sessionId: string;
  scnt: string;
  cookies: StoredCookie[];
  factor?: Factor;
}

export interface AppleSessionOptions {
  fetch?: Fetch;
  now?: () => Date;
  random?: (size: number) => Buffer;
  pending?: PendingVerification;
}

export interface IrisRequest {
  query?: Record<string, string>;
  body?: unknown;
}

export interface AppleSession {
  signIn(appleId: string, password: string): Promise<"signed-in" | "verification-required">;
  requestCode(options?: { sms?: boolean; phone?: string }): Promise<VerificationChallenge>;
  submitCode(code: string): Promise<void>;
  pending(): PendingVerification;
  team(): AppleTeam;
  teams(): AppleTeam[];
  selectTeam(id: number): Promise<void>;
  iris(method: string, path: string, request?: IrisRequest): Promise<unknown>;
}

interface TrustedPhone {
  id: number;
  mode: string;
  label: string;
}

function serviceMessages(body: unknown): string[] {
  const errors = [
    ...listField(body, "serviceErrors"),
    ...listField(body, "service_errors"),
    ...listField(body, "validationErrors"),
  ];
  return errors.map((error) => {
    const message = textField(error, "message") ?? textField(error, "title") ?? "request rejected";
    const code = field(error, "code");
    return typeof code === "string" || typeof code === "number" ? `${message} (${code})` : message;
  });
}

function failureMessage(response: AppleResponse): string {
  const body = parseJson(response.body);
  const service = serviceMessages(body);
  if (service.length > 0) return service.join("; ");
  const first = listField(body, "errors")[0];
  return textField(first, "detail") ?? textField(first, "title") ?? `HTTP ${response.status}`;
}

function phoneMatches(requested: string, masked: string): boolean {
  const clean = (value: string) => value.replace(/[\s \-()"]/g, "");
  const number = clean(requested);
  const label = clean(masked);
  const bullets = [...label].filter((character) => character === "•").length;
  if (bullets === 0) return number === label;
  const prefix = label.slice(0, label.indexOf("•"));
  const suffix = label.slice(label.lastIndexOf("•") + 1);
  const hidden = number.slice(prefix.length, number.length - suffix.length);
  return (
    number.startsWith(prefix) &&
    number.endsWith(suffix) &&
    /^\d+$/.test(hidden) &&
    hidden.length >= Math.max(1, bullets - 2) &&
    hidden.length <= bullets
  );
}

function readTeam(value: unknown): AppleTeam | undefined {
  const id = field(value, "providerId");
  if (typeof id !== "number") return undefined;
  return {
    id,
    issuerId: textField(value, "publicProviderId"),
    name: textField(value, "name") ?? String(id),
  };
}

export function createAppleSession(options: AppleSessionOptions = {}): AppleSession {
  const now = options.now ?? (() => new Date());
  const doFetch = options.fetch ?? fetch;
  const jar = createCookieJar(options.pending?.cookies);
  const transport = createTransport(jar, doFetch);

  let appleId = options.pending?.appleId ?? "";
  let serviceKey = options.pending?.serviceKey ?? "";
  let sessionId = options.pending?.sessionId ?? "";
  let scnt = options.pending?.scnt ?? "";
  let factor = options.pending?.factor;
  let current: AppleTeam | undefined;
  let available: AppleTeam[] = [];

  const authHeaders = (): Record<string, string> => ({
    accept: "application/json, text/javascript",
    "x-requested-with": "XMLHttpRequest",
    "x-apple-widget-key": serviceKey,
    ...(sessionId ? { "x-apple-id-session-id": sessionId } : {}),
    ...(scnt ? { scnt } : {}),
  });

  const auth = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await transport.send(method, `${AUTH_URL}${path}`, {
      headers: authHeaders(),
      body,
    });
    const parsed = parseJson(response.body);
    if (response.status < 200 || response.status >= 300 || serviceMessages(parsed).length > 0) {
      throw new AppleError("verification", failureMessage(response), response.status);
    }
    return parsed;
  };

  const loadServiceKey = async (): Promise<string> => {
    let location: string | null;
    try {
      const response = await doFetch(`${ASC_URL}/logout`, { method: "HEAD", redirect: "manual" });
      location = response.headers.get("location");
    } catch (error) {
      throw new AppleUnreachableError(error);
    }
    const key = location ? new URL(location, ASC_URL).searchParams.get("widgetKey")?.trim() : "";
    if (!key) throw new AppleError("request", "Apple didn't return its sign-in configuration.");
    return key;
  };

  const loadHashcash = async (): Promise<string | undefined> => {
    const response = await transport.send(
      "GET",
      `${AUTH_URL}/signin?widgetKey=${encodeURIComponent(serviceKey)}`,
    );
    const bits = Number(response.headers.get("x-apple-hc-bits"));
    const challenge = response.headers.get("x-apple-hc-challenge");
    if (!challenge || !Number.isInteger(bits) || bits <= 0) return undefined;
    return mintHashcash(bits, challenge, now());
  };

  const loadTeams = async (): Promise<void> => {
    const response = await transport.send("GET", `${ASC_URL}/olympus/v1/session`);
    if (response.status < 200 || response.status >= 300) {
      throw new AppleError(
        response.status === 401 || response.status === 403 ? "forbidden" : "request",
        `App Store Connect didn't accept the sign-in: ${failureMessage(response)}`,
        response.status,
      );
    }
    const body = parseJson(response.body);
    current = readTeam(field(body, "provider"));
    const listed = listField(body, "availableProviders")
      .map(readTeam)
      .filter((team): team is AppleTeam => team !== undefined);
    available = current && !listed.some((team) => team.id === current?.id) ? [current, ...listed] : listed;
    appleId = textField(field(body, "user"), "emailAddress") ?? appleId;
    if (!current) {
      throw new AppleError(
        "forbidden",
        "This Apple Account has no App Store Connect team. Join the Apple Developer Program or accept your team invite, then try again.",
      );
    }
  };

  const trustedPhones = (optionsBody: unknown): TrustedPhone[] =>
    listField(optionsBody, "trustedPhoneNumbers").flatMap((phone) => {
      const id = field(phone, "id");
      if (typeof id !== "number") return [];
      return [
        {
          id,
          mode: textField(phone, "pushMode") ?? "sms",
          label: textField(phone, "numberWithDialCode") ?? "",
        },
      ];
    });

  const requireContinuation = (): void => {
    if (!serviceKey || !sessionId || !scnt) {
      throw new AppleError("verification", "The Apple sign-in expired. Start again.");
    }
  };

  return {
    async signIn(email, password) {
      appleId = email.trim();
      sessionId = "";
      scnt = "";
      factor = undefined;
      serviceKey = await loadServiceKey();
      const ephemeral = createEphemeral(options.random);
      const init = await transport.send("POST", `${AUTH_URL}/signin/init`, {
        headers: authHeaders(),
        body: { a: ephemeral.publicKey, accountName: appleId, protocols: ["s2k", "s2k_fo"] },
      });
      if (init.status === 401 || init.status === 403) {
        throw new AppleError("credentials", "Incorrect Apple Account email or password.", init.status);
      }
      const challenge = parseJson(init.body);
      const salt = textField(challenge, "salt");
      const serverPublicKey = textField(challenge, "b");
      const iterations = field(challenge, "iteration");
      const protocol = textField(challenge, "protocol");
      if (
        init.status !== 200 ||
        !salt ||
        !serverPublicKey ||
        typeof iterations !== "number" ||
        (protocol !== "s2k" && protocol !== "s2k_fo")
      ) {
        throw new AppleError("request", `Apple sign-in failed: ${failureMessage(init)}`, init.status);
      }
      const proof = createProof({
        accountName: appleId,
        password,
        protocol: protocol satisfies PasswordProtocol,
        salt,
        iterations,
        serverPublicKey,
        secret: ephemeral.secret,
      });
      const hashcash = await loadHashcash();
      const complete = await transport.send(
        "POST",
        `${AUTH_URL}/signin/complete?isRememberMeEnabled=false`,
        {
          headers: { ...authHeaders(), ...(hashcash ? { "x-apple-hc": hashcash } : {}) },
          body: {
            accountName: appleId,
            c: field(challenge, "c"),
            m1: proof.m1,
            m2: proof.m2,
            rememberMe: false,
          },
        },
      );
      if (complete.status === 409) {
        sessionId = complete.headers.get("x-apple-id-session-id") ?? "";
        scnt = complete.headers.get("scnt") ?? "";
        requireContinuation();
        return "verification-required";
      }
      if (complete.status === 401 || complete.status === 403) {
        throw new AppleError(
          "credentials",
          "Incorrect Apple Account email or password.",
          complete.status,
        );
      }
      if (complete.status === 412) {
        throw new AppleError(
          "account-action",
          "Apple needs you to review something on this account first. Sign in at https://account.apple.com, finish the prompt, then try again.",
          complete.status,
        );
      }
      if (complete.status !== 200 || serviceMessages(parseJson(complete.body)).length > 0) {
        throw new AppleError(
          "request",
          `Apple sign-in failed: ${failureMessage(complete)}`,
          complete.status,
        );
      }
      await loadTeams();
      return "signed-in";
    },

    async requestCode(request = {}) {
      requireContinuation();
      const body = await auth("GET", "");
      const length = field(field(body, "securityCode"), "length");
      const codeLength = typeof length === "number" && length > 0 ? length : 6;
      const noTrustedDevices = field(body, "noTrustedDevices") === true;
      const phones = trustedPhones(body);

      if (!request.sms && !request.phone && !noTrustedDevices) {
        factor = { method: "device", codeLength };
        return { method: "device", codeLength };
      }
      if (phones.length === 0) {
        throw new AppleError("verification", "This Apple Account has no trusted phone number.");
      }
      const phone = request.phone
        ? phones.find((candidate) => phoneMatches(request.phone ?? "", candidate.label))
        : phones[0];
      if (!phone) {
        throw new AppleError(
          "verification",
          `No trusted phone number matches ${request.phone}. Apple lists: ${phones.map((candidate) => candidate.label).join(", ")}.`,
        );
      }
      if (!(noTrustedDevices && phones.length === 1)) {
        await auth("PUT", "/verify/phone", { phoneNumber: { id: phone.id }, mode: phone.mode });
      }
      factor = {
        method: "phone",
        phoneId: phone.id,
        phoneMode: phone.mode,
        destination: phone.label,
        codeLength,
      };
      return {
        method: phone.mode === "voice" ? "voice" : "sms",
        destination: phone.label || undefined,
        codeLength,
      };
    },

    async submitCode(code) {
      requireContinuation();
      const securityCode = { code: code.trim() };
      if (factor?.method === "phone") {
        await auth("POST", "/verify/phone/securitycode", {
          securityCode,
          phoneNumber: { id: factor.phoneId },
          mode: factor.phoneMode,
        });
      } else {
        await auth("POST", "/verify/trusteddevice/securitycode", { securityCode });
      }
      await auth("GET", "/2sv/trust");
      await loadTeams();
    },

    pending() {
      requireContinuation();
      return { appleId, serviceKey, sessionId, scnt, cookies: jar.snapshot(), factor };
    },

    team() {
      if (!current) throw new AppleError("request", "Sign in to Apple first.");
      return current;
    },

    teams: () => available,

    async selectTeam(id) {
      if (current?.id === id) return;
      if (!available.some((team) => team.id === id)) {
        throw new AppleError(
          "request",
          `This Apple Account isn't on team ${id}. Its teams: ${available.map((team) => `${team.id} (${team.name})`).join(", ")}.`,
        );
      }
      const response = await transport.send("POST", `${ASC_URL}/olympus/v1/session`, {
        headers: { "x-requested-with": "olympus-ui" },
        body: { provider: { providerId: id } },
      });
      if (response.status < 200 || response.status >= 300) {
        throw new AppleError(
          "request",
          `Couldn't switch Apple team: ${failureMessage(response)}`,
          response.status,
        );
      }
      await loadTeams();
      if (current?.id !== id) {
        throw new AppleError("request", `Apple didn't switch to team ${id}.`);
      }
    },

    async iris(method, path, request = {}) {
      const query = new URLSearchParams(request.query).toString();
      const response = await transport.send(
        method,
        `${ASC_URL}/iris/v1${path}${query ? `?${query}` : ""}`,
        {
          headers: {
            accept: "application/vnd.api+json, application/json",
            origin: ASC_URL,
            referer: `${ASC_URL}/access/integrations/api`,
            "x-csrf-itc": "[asc-ui]",
          },
          body: request.body,
        },
      );
      if (response.status < 200 || response.status >= 300) {
        throw new AppleError(
          response.status === 401 || response.status === 403 ? "forbidden" : "request",
          failureMessage(response),
          response.status,
        );
      }
      return parseJson(response.body);
    },
  };
}
