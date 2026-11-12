import { createHash, webcrypto } from "node:crypto";

/**
 * A port of the api's DPoP check (paywall-next `packages/api/src/v2/authn/staffGrant/
 * StaffGrant.ts`, `verifyDpopProof`), minus replay: header `typ` `dpop+jwt`, `alg` ES256,
 * a public EC P-256 `jwk` whose RFC 7638 thumbprint is the grant's `cnf.jkt`, a valid
 * raw r||s signature, `htm`/`htu` (origin + path) for the request, `ath` = SHA-256 of the
 * grant, `iat` within the window, and a `jti` of at most 128 characters.
 */
export const API_DPOP_WINDOW_SECONDS = 15;

export type ProofCheck =
  | "ok"
  | "dpop_invalid"
  | "dpop_key_mismatch"
  | "dpop_request_mismatch"
  | "dpop_expired";

const B64URL = /^[A-Za-z0-9_-]+$/;
const sha256 = (text: string) => createHash("sha256").update(text).digest("base64url");

export async function checkProof(input: {
  readonly proof: string;
  readonly grant: string;
  readonly jkt: string;
  readonly method: string;
  readonly url: string;
  readonly nowSeconds: number;
}): Promise<ProofCheck> {
  const parts = input.proof.split(".");
  if (parts.length !== 3 || !parts.every((part) => B64URL.test(part))) return "dpop_invalid";
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.length !== 64) return "dpop_invalid";
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return "dpop_invalid";
  }
  const jwk = header.jwk as Record<string, unknown> | undefined;
  if (
    header.typ !== "dpop+jwt" ||
    header.alg !== "ES256" ||
    header.crit !== undefined ||
    !jwk ||
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string" ||
    !B64URL.test(jwk.x) ||
    !B64URL.test(jwk.y) ||
    "d" in jwk
  ) {
    return "dpop_invalid";
  }
  const thumbprint = sha256(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`);
  if (thumbprint !== input.jkt) return "dpop_key_mismatch";
  const key = await webcrypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) return "dpop_invalid";
  if (
    typeof claims.jti !== "string" ||
    claims.jti.length === 0 ||
    claims.jti.length > 128 ||
    typeof claims.htm !== "string" ||
    typeof claims.htu !== "string" ||
    typeof claims.iat !== "number" ||
    typeof claims.ath !== "string"
  ) {
    return "dpop_invalid";
  }
  const target = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  };
  if (claims.htm !== input.method || target(claims.htu) !== target(input.url) || claims.ath !== sha256(input.grant)) {
    return "dpop_request_mismatch";
  }
  if (Math.abs(input.nowSeconds - claims.iat) > API_DPOP_WINDOW_SECONDS) return "dpop_expired";
  return "ok";
}
