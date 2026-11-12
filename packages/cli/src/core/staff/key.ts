/**
 * The staff access key: a P-256 key in the Mac's Secure Enclave that signs the DPoP
 * proofs (RFC 9449) staff grants need on every api request. The private key never
 * leaves the Enclave; this module only talks to the `superwall-staff-key` helper binary
 * (`native/staff-key`, protocol in its README) over one JSON request on stdin and one
 * JSON response on stdout.
 *
 * Proofs are built to match the api's verifier (`StaffGrants`, `verifyDpopProof`):
 * header `{ alg: "ES256", typ: "dpop+jwt", jwk }` with the public EC P-256 key only,
 * claims `jti` (random, from the helper), `htm`, `htu` (origin + path), `iat` and `ath`
 * (base64url SHA-256 of the grant or token the proof travels with).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STAFF_KEY_HELPER_OVERRIDE } from "@/environment";
import { SUPERWALL_HOME, packagedDir } from "@/hosts/paths";

/** Where staff access runs. The key lives in the Secure Enclave, so: Macs only. */
export const STAFF_ACCESS_PLATFORMS: readonly NodeJS.Platform[] = ["darwin"];

/** The helper protocol this CLI speaks. */
export const STAFF_KEY_PROTOCOL = 1;

const STAFF_KEY_HELPER_NAME = "superwall-staff-key";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type StaffKeyErrorCode =
  /** Not a Mac. */
  | "unsupported_platform"
  /** The helper binary isn't installed where the CLI looks. */
  | "helper_missing"
  /** The helper crashed, timed out, or answered something that isn't protocol. */
  | "helper_failed"
  /** The helper speaks another protocol version. */
  | "unsupported_version"
  | "bad_request"
  | "no_secure_enclave"
  | "key_exists"
  | "key_not_found"
  | "key_invalid"
  | "secure_enclave_failed"
  | "io_failed"
  | "clock_skew"
  | "internal";

/** The codes the helper itself sends; anything else becomes `helper_failed`. */
const HELPER_CODES: readonly StaffKeyErrorCode[] = [
  "unsupported_version",
  "bad_request",
  "no_secure_enclave",
  "key_exists",
  "key_not_found",
  "key_invalid",
  "secure_enclave_failed",
  "io_failed",
  "clock_skew",
  "internal",
];

export class StaffKeyError extends Error {
  constructor(
    readonly code: StaffKeyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StaffKeyError";
  }
}

export interface PublicJwk {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
}

export interface StaffPublicKey {
  readonly jwk: PublicJwk;
  /** RFC 7638 thumbprint: what a grant's `cnf.jkt` names. */
  readonly jkt: string;
}

export interface StaffKeyHelperInfo {
  readonly helper: string;
  readonly protocol: number;
  readonly secureEnclave: boolean;
}

export interface DpopProofRequest {
  /** The request's HTTP method. */
  readonly method: string;
  /** The request URL; the proof names its origin + path (`htu`). */
  readonly url: string;
  /**
   * The grant (api calls) or session token (authority calls) the proof travels with:
   * its SHA-256 becomes `ath`. Omitted only for calls that carry neither.
   */
  readonly accessToken?: string;
  /** The proof's `iat` in Unix seconds: the caller's clock, corrected for the server's. */
  readonly nowSeconds?: number;
}

export interface DpopProof {
  /** The compact JWS for the `DPoP` header. */
  readonly proof: string;
  readonly jkt: string;
  readonly jti: string;
  readonly iat: number;
}

export interface StaffKeyOptions {
  /** The helper binary. Default: `SUPERWALL_STAFF_KEY_HELPER`, else the packaged one. */
  readonly helper?: string;
  /** The key handle file. Default: `<SUPERWALL_HOME>/staff/key.json`. */
  readonly keyPath?: string;
  /** Default: `process.platform`. */
  readonly platform?: NodeJS.Platform;
  readonly timeoutMs?: number;
}

export interface StaffKey {
  readonly keyPath: string;
  info(): Promise<StaffKeyHelperInfo>;
  /** Creates the key. Refuses with `key_exists` unless `replace`. */
  create(options?: { readonly replace?: boolean }): Promise<StaffPublicKey>;
  publicKey(): Promise<StaffPublicKey>;
  signProof(request: DpopProofRequest): Promise<DpopProof>;
  /** Deletes the key; false when there was none. */
  remove(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Pure helpers (the same computations the api does)
// ---------------------------------------------------------------------------

const base64url = (bytes: Buffer): string => bytes.toString("base64url");

/** RFC 7638 thumbprint of an EC public JWK: SHA-256 of its required members, sorted. */
export function jwkThumbprint(jwk: PublicJwk): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return base64url(createHash("sha256").update(canonical).digest());
}

/** `ath`: base64url SHA-256 of the token a proof travels with (RFC 9449 §4.2). */
export function accessTokenHash(token: string): string {
  return base64url(createHash("sha256").update(token).digest());
}

/** The `htu` the api compares: the URL's origin + path, without query or fragment. */
export function proofTarget(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new StaffKeyError("bad_request", `Not a URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new StaffKeyError("bad_request", `Not an http(s) URL: ${url}`);
  }
  return `${parsed.origin}${parsed.pathname}`;
}

export function staffAccessSupported(platform: NodeJS.Platform = process.platform): boolean {
  return STAFF_ACCESS_PLATFORMS.includes(platform);
}

export function defaultStaffKeyPath(): string {
  return join(SUPERWALL_HOME(), "staff", "key.json");
}

export function defaultStaffKeyHelper(): string {
  return STAFF_KEY_HELPER_OVERRIDE() ?? join(packagedDir("native"), STAFF_KEY_HELPER_NAME);
}

// ---------------------------------------------------------------------------
// Talking to the helper
// ---------------------------------------------------------------------------

type HelperRequest =
  | { readonly op: "version" }
  | { readonly op: "create"; readonly key: string; readonly replace: boolean }
  | { readonly op: "public" | "delete"; readonly key: string }
  | {
      readonly op: "sign";
      readonly key: string;
      readonly htm: string;
      readonly htu: string;
      readonly ath?: string;
      readonly iat: number;
    };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const B64URL = /^[A-Za-z0-9_-]+$/;
const isB64url = (value: unknown): value is string => typeof value === "string" && B64URL.test(value);

const failed = (message: string): StaffKeyError => new StaffKeyError("helper_failed", message);

const isHelperCode = (code: unknown): code is StaffKeyErrorCode =>
  HELPER_CODES.some((known) => known === code);

function runHelper(helper: string, request: HelperRequest, timeoutMs: number): Promise<Json> {
  return new Promise((resolve, reject) => {
    // The helper needs nothing from the environment.
    const child = spawn(helper, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    const stdout: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      return true;
    };
    const finish = (error: StaffKeyError) => {
      if (settle()) reject(error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(failed(`The staff key helper didn't answer within ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        child.kill("SIGKILL");
        finish(failed("The staff key helper's answer is too large"));
        return;
      }
      stdout.push(chunk);
    });
    // Drained and dropped: the protocol answer is on stdout.
    child.stderr.resume();
    child.on("error", (error) => finish(failed(`Couldn't run the staff key helper: ${error.message}`)));
    child.on("close", (code) => {
      const text = Buffer.concat(stdout).toString("utf8").trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        finish(failed(`The staff key helper exited ${code} without an answer`));
        return;
      }
      if (!isObject(parsed) || typeof parsed.ok !== "boolean") {
        finish(failed("The staff key helper's answer isn't a protocol response"));
        return;
      }
      if (parsed.v !== STAFF_KEY_PROTOCOL) {
        finish(
          new StaffKeyError(
            "unsupported_version",
            `The staff key helper speaks protocol ${String(parsed.v)}; this CLI needs ${STAFF_KEY_PROTOCOL}. Update the CLI.`,
          ),
        );
        return;
      }
      if (!parsed.ok) {
        const error = isObject(parsed.error) ? parsed.error : {};
        const code = isHelperCode(error.code) ? error.code : "helper_failed";
        const message = typeof error.message === "string" ? error.message : "The staff key helper failed";
        finish(new StaffKeyError(code, message));
        return;
      }
      if (settle()) resolve(parsed);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ v: STAFF_KEY_PROTOCOL, ...request }));
  });
}

function readPublicKey(response: Json): StaffPublicKey {
  const jwk = response.jwk;
  if (!isObject(jwk) || jwk.kty !== "EC" || jwk.crv !== "P-256" || !isB64url(jwk.x) || !isB64url(jwk.y)) {
    throw failed("The staff key helper returned no P-256 public key");
  }
  if ("d" in jwk) throw failed("The staff key helper returned a private key member");
  const publicJwk: PublicJwk = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
  const jkt = jwkThumbprint(publicJwk);
  if (response.jkt !== jkt) throw failed("The staff key helper's thumbprint doesn't match its key");
  return { jwk: publicJwk, jkt };
}

function readProof(response: Json, expected: { htm: string; htu: string; ath?: string; iat: number }): DpopProof {
  const { proof, jti, iat } = response;
  if (typeof proof !== "string" || typeof jti !== "string" || typeof iat !== "number") {
    throw failed("The staff key helper returned no proof");
  }
  const [header, payload, signature] = proof.split(".");
  if (proof.split(".").length !== 3 || !isB64url(header) || !isB64url(payload) || !isB64url(signature)) {
    throw failed("The staff key helper's proof isn't a compact JWS");
  }
  let decodedHeader: unknown;
  let claims: unknown;
  try {
    decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw failed("The staff key helper's proof isn't JSON");
  }
  if (!isObject(decodedHeader) || decodedHeader.alg !== "ES256" || decodedHeader.typ !== "dpop+jwt") {
    throw failed("The staff key helper's proof has the wrong header");
  }
  const { jkt } = readPublicKey({ jwk: decodedHeader.jwk, jkt: response.jkt });
  if (
    !isObject(claims) ||
    claims.htm !== expected.htm ||
    claims.htu !== expected.htu ||
    claims.ath !== expected.ath ||
    claims.iat !== expected.iat ||
    claims.jti !== jti
  ) {
    throw failed("The staff key helper signed something other than what was asked");
  }
  return { proof, jkt, jti, iat };
}

/**
 * The staff key on this Mac. Every call checks the platform first, so on Linux or
 * Windows each refuses with `unsupported_platform`.
 */
export function staffKey(options: StaffKeyOptions = {}): StaffKey {
  const keyPath = options.keyPath ?? defaultStaffKeyPath();
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const call = (request: HelperRequest): Promise<Json> => {
    if (!staffAccessSupported(platform)) {
      return Promise.reject(
        new StaffKeyError(
          "unsupported_platform",
          "Staff access needs macOS: its key lives in the Mac's Secure Enclave.",
        ),
      );
    }
    const helper = options.helper ?? defaultStaffKeyHelper();
    if (!existsSync(helper)) {
      return Promise.reject(
        new StaffKeyError("helper_missing", `The staff key helper isn't installed (${helper}). Reinstall the CLI.`),
      );
    }
    return runHelper(helper, request, timeoutMs);
  };

  return {
    keyPath,
    async info() {
      const response = await call({ op: "version" });
      if (typeof response.helper !== "string" || typeof response.secureEnclave !== "boolean") {
        throw failed("The staff key helper's version answer is incomplete");
      }
      return { helper: response.helper, protocol: STAFF_KEY_PROTOCOL, secureEnclave: response.secureEnclave };
    },
    async create(createOptions = {}) {
      return readPublicKey(await call({ op: "create", key: keyPath, replace: createOptions.replace ?? false }));
    },
    async publicKey() {
      return readPublicKey(await call({ op: "public", key: keyPath }));
    },
    async signProof(request) {
      const htm = request.method.toUpperCase();
      const htu = proofTarget(request.url);
      const ath = request.accessToken === undefined ? undefined : accessTokenHash(request.accessToken);
      const iat = Math.floor(request.nowSeconds ?? Date.now() / 1000);
      const response = await call({ op: "sign", key: keyPath, htm, htu, iat, ...(ath ? { ath } : {}) });
      return readProof(response, { htm, htu, ath, iat });
    },
    async remove() {
      const response = await call({ op: "delete", key: keyPath });
      if (typeof response.deleted !== "boolean") throw failed("The staff key helper's delete answer is incomplete");
      return response.deleted;
    },
  };
}
