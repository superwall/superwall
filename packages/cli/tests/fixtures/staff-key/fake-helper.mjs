#!/usr/bin/env node
// A stand-in for native/staff-key (protocol 1) that keeps a software P-256 key in the key
// file, so the TypeScript wrapper can be tested anywhere. Tests copy it into a directory of
// its own; a `mode` file beside the copy makes it misbehave (see the switch below).
import { createHash, webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const subtle = webcrypto.subtle;
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const thumbprint = ({ crv, kty, x, y }) =>
  b64(createHash("sha256").update(`{"crv":"${crv}","kty":"${kty}","x":"${x}","y":"${y}"}`).digest());

// fs.writeSync on fd 1, not process.stdout: a pipe write there is asynchronous on macOS
// and process.exit would cut it short.
const write = (text) => writeSync(1, text);
const out = (body, ok) => {
  write(JSON.stringify({ v: 1, ok, ...body }) + "\n");
  process.exit(ok ? 0 : 1);
};
const fail = (code, message) => out({ error: { code, message } }, false);

const input = readFileSync(0, "utf8");
let request;
try {
  request = JSON.parse(input);
} catch {
  fail("bad_request", "not json");
}
if (request.v !== 1) fail("unsupported_version", `protocol 1, not ${request.v}`);

const modeFile = new URL("./mode", import.meta.url);
const mode = existsSync(modeFile) ? readFileSync(modeFile, "utf8").trim() : "";
switch (mode) {
  case "garbage":
    write("not json\n");
    process.exit(0);
  case "silent":
    process.exit(0);
  case "crash":
    process.stderr.write("boom\n");
    process.exit(3);
  case "hang":
    setTimeout(() => undefined, 60_000);
    await new Promise(() => undefined);
    break;
  case "v2":
    write(JSON.stringify({ v: 2, ok: true }) + "\n");
    process.exit(0);
  case "not-response":
    write(JSON.stringify([1, 2]) + "\n");
    process.exit(0);
  case "unknown-error":
    out({ error: { code: "weird", message: "something odd" } }, false);
  case "error-no-message":
    out({}, false);
  case "incomplete":
    out({}, true);
  case "big":
    write("x".repeat(70 * 1024));
    process.exit(0);
}

const publicOf = ({ kty, crv, x, y }) => ({ kty, crv, x, y });
const load = () => {
  if (!existsSync(request.key)) fail("key_not_found", `No staff key at ${request.key}`);
  const file = JSON.parse(readFileSync(request.key, "utf8"));
  if (file.kind !== "fake-software-p256") fail("key_invalid", "not a key");
  return file.jwk;
};
const describe = (jwk) => {
  const pub = publicOf(jwk);
  if (mode === "bad-jkt") return { jwk: pub, jkt: "AAAA" };
  if (mode === "private-jwk") return { jwk: jwk, jkt: thumbprint(pub) };
  return { jwk: pub, jkt: thumbprint(pub) };
};

switch (request.op) {
  case "version":
    out({ helper: "0.0.0-fake", protocol: 1, secureEnclave: true }, true);
  case "create": {
    if (existsSync(request.key) && !request.replace) fail("key_exists", "exists");
    const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await subtle.exportKey("jwk", pair.privateKey);
    mkdirSync(dirname(request.key), { recursive: true, mode: 0o700 });
    writeFileSync(request.key, JSON.stringify({ v: 1, kind: "fake-software-p256", jwk }), { mode: 0o600 });
    out(describe(jwk), true);
  }
  case "public":
    out(describe(load()), true);
  case "sign": {
    if (request.iat !== undefined && Math.abs(request.iat - Date.now() / 1000) > 120) fail("clock_skew", "skew");
    const jwk = load();
    const pub = publicOf(jwk);
    const jti = b64(webcrypto.getRandomValues(new Uint8Array(16)));
    const header = { alg: "ES256", typ: mode === "bad-header" ? "jwt" : "dpop+jwt", jwk: pub };
    const claims = { jti, htm: request.htm, htu: request.htu, iat: request.iat };
    if (request.ath !== undefined) claims.ath = request.ath;
    if (mode === "wrong-claims") claims.htu = "https://evil.example/";
    const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
    const key = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
    let proof = `${input}.${b64(signature)}`;
    if (mode === "not-jws") proof = "a.b";
    if (mode === "not-json-proof") proof = `${b64("{")}.${b64("{")}.${b64(signature)}`;
    if (mode === "no-proof") out({ jkt: thumbprint(pub) }, true);
    out({ proof, jkt: mode === "bad-jkt" ? "AAAA" : thumbprint(pub), jti, iat: request.iat }, true);
  }
  case "delete":
    if (!existsSync(request.key)) out({ deleted: false }, true);
    unlinkSync(request.key);
    out({ deleted: true }, true);
  default:
    fail("bad_request", `Unknown op ${request.op}`);
}
