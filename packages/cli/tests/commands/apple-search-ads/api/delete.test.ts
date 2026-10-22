import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as asaDelete } from "@/commands/apple-search-ads/api/delete";
import { fakeAsaApi } from "../../../helpers/asa";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asa delete with an empty answer says ok", async () => {
  const { api } = fakeAsaApi(() => undefined);
  const del = await runCommand(asaDelete, { args: { path: "/campaigns/1" }, json: true, api });
  assert.deepEqual(del.json, { ok: true });
});
