import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentCredential, MAX_TOKEN_RENEWALS } from "@/core/workspaces/dev/credential";

function counting(fail: () => boolean = () => false) {
  let mints = 0;
  const credential = createAgentCredential(async () => {
    mints += 1;
    if (fail()) throw new Error("down");
    return `t${mints}`;
  });
  return { credential, mints: () => mints };
}

test("one token per run while nothing is refused, even when many ask at once", async () => {
  const { credential, mints } = counting();
  assert.deepEqual(await Promise.all([credential.current(), credential.current()]), ["t1", "t1"]);
  assert.equal(await credential.current(), "t1");
  assert.equal(mints(), 1);
});

test("many requests refused at once share one renewal", async () => {
  const { credential, mints } = counting();
  const token = await credential.current();
  const renewed = await Promise.all(Array.from({ length: 5 }, () => credential.renew(token)));
  assert.deepEqual(new Set(renewed), new Set(["t2"]));
  assert.equal(mints(), 2);
  assert.equal(await credential.current(), "t2");
});

test("a late refusal of an old token takes the newer one instead of minting", async () => {
  const { credential, mints } = counting();
  const token = await credential.current();
  await credential.renew(token);
  assert.equal(await credential.renew(token), "t2");
  assert.equal(mints(), 2);
});

test("a failed first mint or renewal doesn't stick", async () => {
  let failing = true;
  const { credential } = counting(() => failing);
  await assert.rejects(credential.current(), /down/);
  failing = false;
  const token = await credential.current();
  failing = true;
  await assert.rejects(credential.renew(token), /down/);
  failing = false;
  assert.equal(await credential.renew(token), "t4");
});

test("renewals stop at the limit, and say so", async () => {
  const { credential, mints } = counting();
  let token = await credential.current();
  for (let index = 0; index < MAX_TOKEN_RENEWALS; index += 1) token = await credential.renew(token);
  assert.equal(mints(), MAX_TOKEN_RENEWALS + 1);
  await assert.rejects(credential.renew(token), /stopped making more/);
  assert.equal(mints(), MAX_TOKEN_RENEWALS + 1);
});
