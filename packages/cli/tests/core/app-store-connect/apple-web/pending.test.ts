import assert from "node:assert/strict";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { removePending, readPending, writePending } from "@/core/app-store-connect/apple-web/pending";
import type { PendingVerification } from "@/core/app-store-connect/apple-web/session";

const pending: PendingVerification = {
  appleId: "jane@example.com",
  serviceKey: "widget",
  sessionId: "session",
  scnt: "scnt",
  cookies: [{ name: "aasp", value: "1", domain: "idmsa.apple.com", hostOnly: true, path: "/" }],
};
const file = () => join(process.env.SUPERWALL_HOME ?? "", "apple-sign-in.json");

test("a pending sign-in round-trips through a private file", () => {
  writePending(pending);
  assert.equal(statSync(file()).mode & 0o777, 0o600);
  assert.deepEqual(readPending(), pending);
  removePending();
  assert.equal(readPending(), undefined);
});

test("a pending sign-in older than ten minutes is dropped", () => {
  writePending(pending, 1_000);
  assert.deepEqual(readPending(1_000 + 9 * 60 * 1000), pending);
  assert.equal(readPending(1_000 + 11 * 60 * 1000), undefined);
  assert.equal(readPending(1_000), undefined);
});

test("a corrupt file reads as no pending sign-in", () => {
  writeFileSync(file(), "not json");
  assert.equal(readPending(), undefined);
  removePending();
});
