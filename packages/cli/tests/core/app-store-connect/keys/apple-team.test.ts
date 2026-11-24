import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { readAppleKeyTeam } from "@/core/app-store-connect/keys/apple-team";

const privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

test("an Apple request that never answers ends at its deadline as unreachable", async () => {
  const original = globalThis.fetch;
  let signalled = false;
  globalThis.fetch = ((_url: string, init: RequestInit = {}) =>
    new Promise((_resolve, reject) => {
      signalled = init.signal instanceof AbortSignal;
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    const team = await readAppleKeyTeam({ keyId: "K1", issuerId: "I1", privateKey }, 20);
    assert.equal(signalled, true);
    assert.deepEqual(team, { status: "unreachable", reason: "no answer within 0.02s" });
  } finally {
    clearTimeout(keepAlive);
    globalThis.fetch = original;
  }
});
