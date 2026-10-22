import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { command as asa } from "@/commands/apple-search-ads/asa";
import { fakeAsaApi } from "../../helpers/asa";
import { runCommand } from "../../helpers/command";

afterEach(() => {
  mock.restoreAll();
  process.exitCode = 0;
});

const errorOf = (result: { json: unknown }) => (result.json as { error: { message: string } }).error.message;

test("bare asa shows the help page through the host", async () => {
  const { api, requests } = fakeAsaApi();
  const text = await runCommand(asa, { words: [], api });
  assert.match(stripVTControlCharacters(text.said("report").join("\n")), /^superwall asa <resource> <operation>\n/);
  const json = await runCommand(asa, { words: [], api, json: true });
  assert.match((json.json as { markdown: string }).markdown, /superwall asa <resource> <operation>/);
  assert.deepEqual(requests, []);
});

test("extra words are refused before anything is sent", async () => {
  const { api, requests } = fakeAsaApi();
  const result = await runCommand(asa, { words: ["campaigns", "get", "1", "2", "3"], api, json: true });
  assert.equal(errorOf(result), '`superwall asa` doesn\'t take "2 3".');
  assert.deepEqual(requests, []);
});

test("a raw path is a GET with -d as query parameters and the org context", async () => {
  const { api, requests } = fakeAsaApi(() => ({ data: [] }));
  await runCommand(asa, { words: ["/campaigns"], flags: { d: ["limit=2"], orgId: "40" }, api, json: true });
  assert.deepEqual(requests.at(-1), {
    method: "GET",
    path: "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/campaigns?limit=2",
    body: undefined,
    headers: { "x-ap-context": "orgId=40" },
  });
});

test("me defaults to get, and money flags take the --currency given", async () => {
  const me = fakeAsaApi(() => ({ data: { userId: 1 } }));
  const shown = await runCommand(asa, { words: ["me"], api: me.api, json: true });
  assert.deepEqual(shown.json, { data: { userId: 1 } });
  assert.equal(me.requests.at(-1)?.path, "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/me");

  const create = fakeAsaApi(() => ({ data: { id: 1 } }));
  await runCommand(asa, {
    words: ["campaigns", "create"],
    flags: { name: "Launch", budget: "100", currency: "eur" },
    api: create.api,
    json: true,
  });
  const posted = create.requests.find((request) => request.method === "POST");
  assert.deepEqual(posted?.body, { name: "Launch", budgetAmount: { amount: "100", currency: "EUR" } });
  assert.ok(!create.requests.some((request) => request.path.endsWith("/acls")));
});

test("an unknown resource or operation names what there is, without looking up an app", async () => {
  const { api, requests } = fakeAsaApi();
  const group = await runCommand(asa, { words: ["widgets"], api, json: true });
  assert.match(errorOf(group), /^asa has no "widgets"\. It takes: campaigns, adgroups, .*, docs, keys, get, post, put, delete, or a \/path\.\nRun superwall asa --help for what each does\.$/);
  const action = await runCommand(asa, { words: ["me", "list"], api, json: true });
  assert.equal(errorOf(action), 'asa me has no "list". It takes: get.\nRun superwall asa me --help for what each does.');
  assert.deepEqual(requests, []);
});
