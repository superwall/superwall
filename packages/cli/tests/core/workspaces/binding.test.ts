import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { readBinding, readSourceFile, writeBinding } from "@/core/workspaces/binding";
import { scratch } from "./fixture";

test("a binding round-trips, and its sync point stays out of the source tree", () => {
  const root = scratch();
  assert.equal(readBinding(root), undefined);
  writeBinding(root, { workspaceId: "1", organizationId: "2", slug: "x", syncedCommit: "abc" });
  assert.deepEqual(readBinding(root), { workspaceId: "1", organizationId: "2", slug: "x", syncedCommit: "abc" });
  const pushed = JSON.parse(readSourceFile(root, "superwall.workspace.json").toString());
  assert.deepEqual(pushed, { workspace_id: 1, organization_id: 2, slug: "x" });
  fs.writeFileSync(path.join(root, "other"), "raw");
  assert.equal(readSourceFile(root, "other").toString(), "raw");
});

test("a damaged binding says so", () => {
  const root = scratch();
  fs.writeFileSync(path.join(root, "superwall.workspace.json"), "{nope");
  assert.throws(() => readBinding(root), /not valid JSON/);
  fs.writeFileSync(path.join(root, "superwall.workspace.json"), "{}");
  assert.throws(() => readBinding(root), /needs workspace_id/);
});
