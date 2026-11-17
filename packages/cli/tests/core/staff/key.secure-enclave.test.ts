/**
 * The real helper on this Mac's Secure Enclave. Runs only on macOS once the helper is
 * built (`bun run build:staff-key`, or `swift build -c release` in native/staff-key), so CI
 * on Linux skips it; the wrapper's own behaviour is covered by key.test.ts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, test } from "node:test";
import { StaffKeyError, staffKey } from "@/core/staff/key";
import { checkProof } from "../../helpers/dpop";

const native = path.join(import.meta.dirname, "../../../native/staff-key");
const HELPER = [
  process.env.SUPERWALL_STAFF_KEY_LIVE_HELPER,
  path.join(native, ".build/release/superwall-staff-key"),
  path.join(native, ".build/apple/Products/Release/superwall-staff-key"),
].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

const skip =
  process.platform !== "darwin"
    ? "staff access is macOS only"
    : HELPER === undefined
      ? "the helper isn't built (bun run build:staff-key)"
      : false;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-se-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** One raw protocol exchange, bypassing the wrapper's own checks. */
function raw(request: Record<string, unknown>): { status: number | null; body: Record<string, any> } {
  const result = spawnSync(HELPER!, [], { input: JSON.stringify(request), encoding: "utf8" });
  return { status: result.status, body: JSON.parse(result.stdout) };
}

describe("the Secure Enclave helper", { skip }, () => {
  const keyPath = path.join(dir, "staff", "key.json");
  const key = staffKey({ helper: HELPER, keyPath });
  const GRANT = "eyJhbGciOiJFZERTQSIsInR5cCI6InN3LXN0YWZmLWdyYW50K2p3dCJ9.e30.c2ln";

  test("has a Secure Enclave and speaks protocol 1", async () => {
    const info = await key.info();
    assert.equal(info.protocol, 1);
    assert.equal(info.secureEnclave, true);
  });

  test("creates a key, signs proofs the api's checks accept, deletes it", async () => {
    const created = await key.create();
    assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(keyPath)).mode & 0o777, 0o700);
    // The file is the Enclave's wrapped handle: no private key material in the clear.
    const file = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    assert.deepEqual(Object.keys(file).sort(), ["data", "kind", "v"]);
    assert.equal(file.kind, "secure-enclave-p256");
    assert.deepEqual(await key.publicKey(), created);

    const now = Math.floor(Date.now() / 1000);
    for (const [method, url] of [
      ["GET", "https://api.superwall.com/v2/projects?limit=10"],
      ["POST", "https://api.superwall.com/v2/projects/12/applications/34/paywalls"],
      ["DELETE", "http://localhost:8787/v2/me"],
    ] as const) {
      const signed = await key.signProof({ method, url, accessToken: GRANT, nowSeconds: now });
      assert.equal(signed.jkt, created.jkt);
      assert.ok(signed.jti.length >= 16 && signed.jti.length <= 128);
      const header = JSON.parse(Buffer.from(signed.proof.split(".")[0]!, "base64url").toString("utf8"));
      assert.deepEqual(header, { alg: "ES256", typ: "dpop+jwt", jwk: created.jwk });
      assert.equal(
        await checkProof({ proof: signed.proof, grant: GRANT, jkt: created.jkt, method, url, nowSeconds: now }),
        "ok",
      );
      assert.equal(
        await checkProof({ proof: signed.proof, grant: GRANT, jkt: created.jkt, method, url, nowSeconds: now + 16 }),
        "dpop_expired",
      );
    }

    // A replaced key is a different key, and the old thumbprint no longer verifies.
    const replaced = await key.create({ replace: true });
    assert.notEqual(replaced.jkt, created.jkt);
    const signed = await key.signProof({ method: "GET", url: "https://api.superwall.com/v2/me", accessToken: GRANT, nowSeconds: now });
    assert.equal(
      await checkProof({ proof: signed.proof, grant: GRANT, jkt: created.jkt, method: "GET", url: "https://api.superwall.com/v2/me", nowSeconds: now }),
      "dpop_key_mismatch",
    );

    assert.equal(await key.remove(), true);
    assert.equal(fs.existsSync(keyPath), false);
    assert.equal(await key.remove(), false);
    await assert.rejects(key.publicKey(), (error: unknown) => error instanceof StaffKeyError && error.code === "key_not_found");
  });

  test("refuses what the wrapper would never send", () => {
    const k = path.join(dir, "raw", "key.json");
    assert.equal(raw({ v: 1, op: "create", key: k }).status, 0);
    assert.equal(raw({ v: 1, op: "create", key: k }).body.error.code, "key_exists");
    const sign = (extra: Record<string, unknown>) =>
      raw({ v: 1, op: "sign", key: k, htm: "GET", htu: "https://api.superwall.com/v2/me", ...extra }).body;
    assert.equal(sign({}).ok, true);
    for (const htu of [
      "https://api.superwall.com/v2/me?x=1",
      "https://api.superwall.com/v2/me#f",
      "https://API.superwall.com/v2/me",
      "https://api.superwall.com:443/v2/me",
      "https://u@api.superwall.com/v2/me",
      "http://api.superwall.com/v2/me",
      "https://api.superwall.com",
      "ftp://api.superwall.com/x",
    ]) {
      assert.equal(sign({ htu }).error?.code, "bad_request", htu);
    }
    assert.equal(sign({ htm: "get" }).error.code, "bad_request");
    assert.equal(sign({ ath: "short" }).error.code, "bad_request");
    assert.equal(sign({ iat: Math.floor(Date.now() / 1000) - 600 }).error.code, "clock_skew");
    assert.equal(raw({ v: 1, op: "sign", key: "relative/key.json", htm: "GET", htu: "https://a.b/" }).body.error.code, "bad_request");
    assert.equal(raw({ v: 2, op: "version" }).body.error.code, "unsupported_version");
    assert.equal(raw({ v: 1, op: "export", key: k }).body.error.code, "bad_request");

    // Never a way to delete a file that isn't a staff key.
    const other = path.join(dir, "raw", "notes.txt");
    fs.writeFileSync(other, "keep me");
    const refused = raw({ v: 1, op: "delete", key: other });
    assert.equal(refused.status, 1);
    assert.equal(refused.body.error.code, "key_invalid");
    assert.equal(fs.readFileSync(other, "utf8"), "keep me");

    assert.equal(raw({ v: 1, op: "delete", key: k }).body.deleted, true);
  });
});
