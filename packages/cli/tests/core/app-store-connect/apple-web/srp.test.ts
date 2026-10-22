import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createEphemeral, createProof, type PasswordProtocol } from "@/core/app-store-connect/apple-web/srp";

interface Vector {
  protocol: PasswordProtocol;
  accountName: string;
  password: string;
  salt: string;
  iterations: number;
  secretHex: string;
  publicKey: string;
  serverPublicKey: string;
  m1: string;
  m2: string;
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../fixtures/apple/srp-vectors.json", import.meta.url), "utf8"),
) as Vector[];

for (const vector of vectors) {
  test(`${vector.protocol} proof matches an independent SRP implementation`, () => {
    const ephemeral = createEphemeral(() => Buffer.from(vector.secretHex, "hex"));
    assert.equal(ephemeral.publicKey, vector.publicKey);
    assert.deepEqual(createProof({ ...vector, secret: ephemeral.secret }), {
      m1: vector.m1,
      m2: vector.m2,
    });
  });
}

test("a different password changes the proof", () => {
  const vector = vectors[0]!;
  const secret = createEphemeral(() => Buffer.from(vector.secretHex, "hex")).secret;
  assert.notEqual(createProof({ ...vector, password: "wrong", secret }).m1, vector.m1);
});

test("ephemeral secrets are random by default", () => {
  assert.notEqual(createEphemeral().publicKey, createEphemeral().publicKey);
});

test("rejects a server value that is zero or too wide", () => {
  const vector = vectors[0]!;
  const secret = createEphemeral(() => Buffer.from(vector.secretHex, "hex")).secret;
  assert.throws(() => createProof({ ...vector, serverPublicKey: "", secret }), /invalid sign-in/);
  assert.throws(
    () =>
      createProof({
        ...vector,
        serverPublicKey: Buffer.alloc(300, 1).toString("base64"),
        secret,
      }),
    /invalid sign-in/,
  );
});
