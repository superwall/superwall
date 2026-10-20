import assert from "node:assert/strict";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { clearPending, loadPending, savePending } from "@/core/apple/pending";
import type { PendingVerification } from "@/core/apple/session";

const pending: PendingVerification = {
  appleId: "jane@example.com",
  serviceKey: "widget",
  sessionId: "session",
  scnt: "scnt",
  cookies: [{ name: "aasp", value: "1", domain: "idmsa.apple.com", hostOnly: true, path: "/" }],
};
const file = () => join(process.env.SUPERWALL_HOME ?? "", "apple-sign-in.json");

test("a pending sign-in round-trips through a private file", () => {
  savePending(pending);
  assert.equal(statSync(file()).mode & 0o777, 0o600);
  assert.deepEqual(loadPending(), pending);
  clearPending();
  assert.equal(loadPending(), undefined);
});

test("a pending sign-in older than ten minutes is dropped", () => {
  savePending(pending, 1_000);
  assert.deepEqual(loadPending(1_000 + 9 * 60 * 1000), pending);
  assert.equal(loadPending(1_000 + 11 * 60 * 1000), undefined);
  assert.equal(loadPending(1_000), undefined);
});

test("a corrupt file reads as no pending sign-in", () => {
  writeFileSync(file(), "not json");
  assert.equal(loadPending(), undefined);
  clearPending();
});
