import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  STAFF_ACCESS_PLATFORMS,
  StaffKeyError,
  accessTokenHash,
  defaultStaffKeyHelper,
  defaultStaffKeyPath,
  jwkThumbprint,
  proofTarget,
  staffAccessSupported,
  staffKey,
  type StaffKeyOptions,
} from "@/core/staff/key";
import { checkProof } from "../../helpers/dpop";
import { clearHomes, useHome } from "../../helpers/home";

const ENV_STAFF_KEY_HELPER = "SUPERWALL_STAFF_KEY_HELPER";
const FAKE = path.join(import.meta.dirname, "../../fixtures/staff-key/fake-helper.mjs");
const dirs: string[] = [];

afterEach(() => {
  clearHomes();
  delete process.env[ENV_STAFF_KEY_HELPER];
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A copy of the fake helper in a directory of its own, optionally misbehaving. */
function fake(mode?: string): { helper: string; keyPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-staff-key-"));
  dirs.push(dir);
  const helper = path.join(dir, "fake-helper.mjs");
  fs.copyFileSync(FAKE, helper);
  fs.chmodSync(helper, 0o755);
  if (mode) fs.writeFileSync(path.join(dir, "mode"), mode);
  return { helper, keyPath: path.join(dir, "home", "staff", "key.json") };
}

const onMac = (options: StaffKeyOptions): StaffKeyOptions => ({ platform: "darwin", ...options });

const rejectsWith = (promise: Promise<unknown>, code: string, message?: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof StaffKeyError, `expected a StaffKeyError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });

const GRANT = "eyJhbGciOiJFZERTQSJ9.e30.c2ln";
const URL_ = "https://api.superwall.com/v2/projects/12/applications?limit=5#top";

describe("pure helpers", () => {
  test("the thumbprint is RFC 7638's (its §3.1 example, recomputed for EC)", () => {
    const jwk = { kty: "EC", crv: "P-256", x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0" } as const;
    const expected = createHash("sha256")
      .update(`{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`)
      .digest("base64url");
    assert.equal(jwkThumbprint(jwk), expected);
    assert.equal(jwkThumbprint(jwk).length, 43);
  });

  test("ath is the base64url SHA-256 of the token", () => {
    assert.equal(accessTokenHash("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });

  test("htu is the URL's origin and path: no query, fragment, default port or credentials", () => {
    assert.equal(proofTarget(URL_), "https://api.superwall.com/v2/projects/12/applications");
    assert.equal(proofTarget("https://API.superwall.com:443"), "https://api.superwall.com/");
    assert.equal(proofTarget("https://u:p@superwallstaff.com/cli/grants"), "https://superwallstaff.com/cli/grants");
    assert.equal(proofTarget("http://localhost:8787/v2/me"), "http://localhost:8787/v2/me");
  });

  test("htu refuses what isn't an http(s) URL", () => {
    assert.throws(() => proofTarget("not a url"), (error: unknown) => error instanceof StaffKeyError && error.code === "bad_request");
    assert.throws(() => proofTarget("file:///etc/passwd"), (error: unknown) => error instanceof StaffKeyError && error.code === "bad_request");
  });

  test("staff access is macOS only, from one list", () => {
    assert.deepEqual(STAFF_ACCESS_PLATFORMS, ["darwin"]);
    assert.equal(staffAccessSupported("darwin"), true);
    assert.equal(staffAccessSupported("linux"), false);
    assert.equal(staffAccessSupported("win32"), false);
    assert.equal(staffAccessSupported(), process.platform === "darwin");
  });

  test("the key lives under SUPERWALL_HOME; the helper is packaged, or named by the env", () => {
    const home = useHome();
    assert.equal(defaultStaffKeyPath(), path.join(home, "staff", "key.json"));
    assert.match(defaultStaffKeyHelper(), /dist\/native\/superwall-staff-key$/);
    process.env[ENV_STAFF_KEY_HELPER] = "/opt/helper";
    assert.equal(defaultStaffKeyHelper(), "/opt/helper");
  });
});

describe("the wrapper with a working helper", () => {
  test("create, read the public key, sign a proof the api accepts, delete", async () => {
    const key = staffKey(onMac(fake()));
    const created = await key.create();
    assert.deepEqual(Object.keys(created.jwk).sort(), ["crv", "kty", "x", "y"]);
    assert.equal(created.jkt, jwkThumbprint(created.jwk));
    assert.equal(fs.statSync(key.keyPath).mode & 0o777, 0o600);

    assert.deepEqual(await key.publicKey(), created);

    const now = Math.floor(Date.now() / 1000);
    const signed = await key.signProof({ method: "post", url: URL_, accessToken: GRANT, nowSeconds: now + 0.7 });
    assert.equal(signed.jkt, created.jkt);
    assert.equal(signed.iat, now);
    const request = { grant: GRANT, jkt: created.jkt, method: "POST", url: URL_ };
    assert.equal(await checkProof({ proof: signed.proof, ...request, nowSeconds: now }), "ok");

    assert.equal(await key.remove(), true);
    assert.equal(fs.existsSync(key.keyPath), false);
    assert.equal(await key.remove(), false);
    await rejectsWith(key.publicKey(), "key_not_found");
  });

  test("every proof has its own jti, and defaults iat to now", async () => {
    const key = staffKey(onMac(fake()));
    await key.create();
    const before = Math.floor(Date.now() / 1000);
    const [a, b] = await Promise.all([
      key.signProof({ method: "GET", url: URL_, accessToken: GRANT }),
      key.signProof({ method: "GET", url: URL_, accessToken: GRANT }),
    ]);
    assert.notEqual(a.jti, b.jti);
    assert.ok(a.iat >= before && a.iat <= Math.floor(Date.now() / 1000));
  });

  test("a proof without a token has no ath (authority calls before a session)", async () => {
    const key = staffKey(onMac(fake()));
    await key.create();
    const { proof } = await key.signProof({ method: "POST", url: "https://superwallstaff.com/cli/device" });
    const claims = JSON.parse(Buffer.from(proof.split(".")[1]!, "base64url").toString("utf8"));
    assert.equal(claims.ath, undefined);
    assert.equal(claims.htu, "https://superwallstaff.com/cli/device");
  });

  test("create refuses to replace a key unless asked", async () => {
    const key = staffKey(onMac(fake()));
    const first = await key.create();
    await rejectsWith(key.create(), "key_exists");
    const second = await key.create({ replace: true });
    assert.notEqual(second.jkt, first.jkt);
  });

  test("helper errors come through with their code and message", async () => {
    const key = staffKey(onMac(fake()));
    await key.create();
    await rejectsWith(
      key.signProof({ method: "GET", url: URL_, accessToken: GRANT, nowSeconds: Date.now() / 1000 - 600 }),
      "clock_skew",
    );
  });

  test("info reports the helper and the Secure Enclave", async () => {
    const info = await staffKey(onMac(fake())).info();
    assert.deepEqual(info, { helper: "0.0.0-fake", protocol: 1, secureEnclave: true });
  });

  test("the helper comes from SUPERWALL_STAFF_KEY_HELPER and the key from SUPERWALL_HOME by default", async () => {
    const home = useHome();
    process.env[ENV_STAFF_KEY_HELPER] = fake().helper;
    const key = staffKey({ platform: "darwin" });
    assert.equal(key.keyPath, path.join(home, "staff", "key.json"));
    await key.create();
    assert.ok(fs.existsSync(path.join(home, "staff", "key.json")));
  });
});

describe("the api's checks catch a proof that's wrong", () => {
  test("another key, method, URL, grant, a stale iat, a private member, bad signature", async () => {
    const key = staffKey(onMac(fake()));
    const { jkt } = await key.create();
    const now = Math.floor(Date.now() / 1000);
    const { proof } = await key.signProof({ method: "GET", url: URL_, accessToken: GRANT, nowSeconds: now });
    const base = { proof, grant: GRANT, jkt, method: "GET", url: URL_, nowSeconds: now };
    assert.equal(await checkProof({ ...base, jkt: "x".repeat(43) }), "dpop_key_mismatch");
    assert.equal(await checkProof({ ...base, method: "POST" }), "dpop_request_mismatch");
    assert.equal(await checkProof({ ...base, url: "https://api.superwall.com/v2/me" }), "dpop_request_mismatch");
    assert.equal(await checkProof({ ...base, grant: "another" }), "dpop_request_mismatch");
    assert.equal(await checkProof({ ...base, nowSeconds: now + 16 }), "dpop_expired");
    assert.equal(await checkProof({ ...base, nowSeconds: now + 15 }), "ok");

    const [header, payload, signature] = proof.split(".") as [string, string, string];
    const reencode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const flipped = `${signature.slice(0, -2)}${signature.endsWith("AA") ? "BA" : "AA"}`;
    assert.equal(await checkProof({ ...base, proof: `${header}.${payload}.${flipped}` }), "dpop_invalid");
    assert.equal(await checkProof({ ...base, proof: `${header}.${payload}.AAAA` }), "dpop_invalid");
    assert.equal(await checkProof({ ...base, proof: "a.b" }), "dpop_invalid");
    assert.equal(await checkProof({ ...base, proof: `${reencode("{")}x.${payload}.${signature}`.replace(/=/g, "") }), "dpop_invalid");
    assert.equal(
      await checkProof({ ...base, proof: `${reencode({ ...decoded, jwk: { ...decoded.jwk, d: "AA" } })}.${payload}.${signature}` }),
      "dpop_invalid",
    );
    assert.equal(
      await checkProof({ ...base, proof: `${reencode({ ...decoded, typ: "jwt" })}.${payload}.${signature}` }),
      "dpop_invalid",
    );
    // Claims the signature doesn't cover.
    assert.equal(
      await checkProof({ ...base, proof: `${header}.${reencode({ ...claims, htm: "POST" })}.${signature}` }),
      "dpop_invalid",
    );
  });

  test("a signed proof missing a claim is refused", async () => {
    const key = staffKey(onMac(fake()));
    const { jkt } = await key.create();
    const now = Math.floor(Date.now() / 1000);
    const { proof } = await key.signProof({ method: "GET", url: URL_, nowSeconds: now });
    assert.equal(await checkProof({ proof, grant: GRANT, jkt, method: "GET", url: URL_, nowSeconds: now }), "dpop_invalid");
  });
});

describe("the wrapper refuses", () => {
  test("anywhere but macOS, before running anything", async () => {
    for (const platform of ["linux", "win32"] as const) {
      const key = staffKey({ ...fake(), platform });
      await rejectsWith(key.create(), "unsupported_platform", /needs macOS/);
      await rejectsWith(key.signProof({ method: "GET", url: URL_ }), "unsupported_platform");
    }
  });

  test("when the helper isn't installed", async () => {
    await rejectsWith(staffKey(onMac({ helper: "/nonexistent/superwall-staff-key" })).info(), "helper_missing", /Reinstall/);
  });

  test("a helper it can't run", async () => {
    const { helper } = fake();
    fs.chmodSync(helper, 0o644);
    await rejectsWith(staffKey(onMac({ helper })).info(), "helper_failed", /Couldn't run/);
  });

  test("answers that aren't protocol", async () => {
    const cases: Array<[string, RegExp]> = [
      ["garbage", /without an answer/],
      ["silent", /without an answer/],
      ["crash", /exited 3/],
      ["not-response", /isn't a protocol response/],
      ["incomplete", /incomplete/],
      ["big", /too large/],
    ];
    for (const [mode, message] of cases) {
      await rejectsWith(staffKey(onMac(fake(mode))).info(), "helper_failed", message);
    }
  });

  test("a helper that hangs, after the timeout", async () => {
    await rejectsWith(staffKey(onMac({ ...fake("hang"), timeoutMs: 300 })).info(), "helper_failed", /within 300 ms/);
  });

  test("a helper on another protocol version", async () => {
    await rejectsWith(staffKey(onMac(fake("v2"))).info(), "unsupported_version", /Update the CLI/);
  });

  test("error codes it doesn't know, or errors without a message", async () => {
    await rejectsWith(staffKey(onMac(fake("unknown-error"))).info(), "helper_failed", /something odd/);
    await rejectsWith(staffKey(onMac(fake("error-no-message"))).info(), "helper_failed", /helper failed/);
  });

  test("a public key that isn't one, or doesn't match its thumbprint", async () => {
    for (const [mode, message] of [
      ["bad-jkt", /thumbprint/],
      ["private-jwk", /private key member/],
    ] as const) {
      const options = onMac(fake());
      await staffKey(options).create();
      fs.writeFileSync(path.join(path.dirname(options.helper!), "mode"), mode);
      await rejectsWith(staffKey(options).publicKey(), "helper_failed", message);
    }
    await rejectsWith(staffKey(onMac(fake("incomplete"))).create(), "helper_failed", /no P-256 public key/);
  });

  test("a proof that isn't what was asked for", async () => {
    for (const [mode, message] of [
      ["wrong-claims", /something other than what was asked/],
      ["bad-header", /wrong header/],
      ["not-jws", /compact JWS/],
      ["not-json-proof", /isn't JSON/],
      ["no-proof", /no proof/],
      ["bad-jkt", /thumbprint/],
    ] as const) {
      const options = onMac(fake());
      await staffKey(options).create();
      fs.writeFileSync(path.join(path.dirname(options.helper!), "mode"), mode);
      await rejectsWith(staffKey(options).signProof({ method: "GET", url: URL_, accessToken: GRANT }), "helper_failed", message);
    }
  });

  test("a delete answer without its result", async () => {
    await rejectsWith(staffKey(onMac(fake("incomplete"))).remove(), "helper_failed", /delete answer/);
  });

  test("a URL that can't be a proof target, without asking the helper", async () => {
    const key = staffKey(onMac(fake("crash")));
    await rejectsWith(key.signProof({ method: "GET", url: "ftp://example.com/x" }), "bad_request");
  });
});
