import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as asaPost } from "@/commands/apple-search-ads/api/post";
import { fakeAsaApi } from "../../../helpers/asa";
import { helpLine, runCommand, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asa post merges -d into --body", async () => {
  const { api, requests } = fakeAsaApi();
  await runCommand(asaPost, {
    args: { path: "/campaigns/find" },
    flags: { body: '{"conditions":[]}', d: ['fields:=["id"]'] },
    json: true,
    api,
  });
  assert.deepEqual(requests.at(-1)?.body, { conditions: [], fields: ["id"] });
});

test("asa post through the parser sends -d as the body and prints Apple's answer", async () => {
  const { api, requests } = fakeAsaApi(() => ({ data: [{ id: 1 }] }));
  const result = await runLine("asa post /campaigns/find -d pagination[limit]:=5 --json", { api });
  assert.deepEqual(requests.at(-1)?.body, { pagination: { limit: 5 } });
  assert.equal(requests.at(-1)?.method, "POST");
  assert.deepEqual(result.json, { data: [{ id: 1 }] });
});

test("an asa post Apple answers with nothing prints ok", async () => {
  const { api } = fakeAsaApi(() => undefined);
  const result = await runLine("asa post /campaigns/find --json", { api });
  assert.deepEqual(result.json, { ok: true });
});

test("asa post --help says how to pass a body", async () => {
  const help = await helpLine("asa post --help");
  assert.match(help, /--body <json>/);
  assert.match(help, /@file, or @- for stdin/);
});
