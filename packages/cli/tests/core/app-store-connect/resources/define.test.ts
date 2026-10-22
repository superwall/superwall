import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as groups } from "@/commands/app-store-connect/store/subscription-groups";
import { command as screenshots } from "@/commands/app-store-connect/store/screenshots";
import { command as subscriptions } from "@/commands/app-store-connect/store/subscriptions";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { GROUPS_OF_APP } from "../../../helpers/asc-store";
import { runCommand, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("the parser types the flags: booleans, numbers, case-insensitive choices", async () => {
  const { api, writes } = ascRoutes({ "PATCH /v1/subscriptions/601": undefined });
  await runLine("asc subscriptions update 601 --family-sharable --group-level 3 --subscription-period one-year", { api });
  assert.deepEqual(writes()[0]?.body, {
    data: { type: "subscriptions", id: "601", attributes: { subscriptionPeriod: "ONE_YEAR", familySharable: true, groupLevel: 3 } },
  });
  await runLine("asc subscriptions update 601 --no-family-sharable", { api });
  assert.deepEqual(writes()[1]?.body, { data: { type: "subscriptions", id: "601", attributes: { familySharable: false } } });
});

test("bad input is refused before anything is sent", async () => {
  const { api, sent } = ascRoutes({});
  const cases: [string[], Record<string, unknown>, string][] = [
    [["nope"], {}, 'asc subscriptions has no "nope". It takes: list, get, create, update, delete.\nRun superwall asc subscriptions --help for what each does.'],
    [["get"], {}, "asc subscriptions get needs <id>."],
    [["get", "1", "2"], {}, 'asc subscriptions get doesn\'t take "2".'],
    [["update", "1"], { bogus: "x" }, "asc subscriptions update has no --bogus. Run superwall asc subscriptions update --help for its flags."],
    [["update", "1"], { subscriptionPeriod: "MONTHLY" }, '--subscription-period takes one of: ONE_WEEK, ONE_MONTH, TWO_MONTHS, THREE_MONTHS, SIX_MONTHS, ONE_YEAR (not "MONTHLY").'],
    [["update", "1"], { groupLevel: "high" }, '--group-level takes a number, not "high".'],
    [["update", "1"], { familySharable: "maybe" }, '--family-sharable is true or false, not "maybe".'],
    [["create"], { group: "1", name: "x", subscriptionPeriod: "ONE_WEEK", price: "1" }, "asc subscriptions create needs --product-id."],
  ];
  for (const [words, flags, message] of cases) {
    const result = await runCommand(subscriptions, { api, words, flags });
    assert.deepEqual(result.said("error"), [message], words.join(" "));
  }
  assert.deepEqual(sent, []);
});

test("a blank value counts as absent", async () => {
  const { api, sent } = ascRoutes({});
  const blank = await runCommand(subscriptions, { api, words: ["list"], flags: { group: "  " } });
  assert.deepEqual(blank.said("error"), ["Pass the App Store app (asc subscriptions list <id|bundle id>), or --group <id>."]);
  assert.deepEqual(sent, []);
});

test("with no operation it shows what the resource does", async () => {
  const { api } = ascRoutes({});
  const human = await runCommand(groups, { api });
  assert.match(human.stdout + human.said("report").join(""), /Operations/);
  const json = await runCommand(groups, { api, json: true });
  assert.match((json.json as { markdown: string }).markdown, /subscription-groups/);
});

test("rows print one per line, counted", async () => {
  const { api } = ascRoutes({ [GROUPS_OF_APP]: page([one("subscriptionGroups", "201", { referenceName: "Pro" })]) });
  const result = await runLine("asc subscription-groups list 555", { api });
  assert.deepEqual(result.said("step"), ["1 subscription group"]);
});

test("each operation is an MCP tool with its required inputs; local-only ones are not", async () => {
  const tools = await subscriptions.tools();
  const create = tools.find((tool) => tool.words[0] === "create");
  assert.deepEqual(create?.input.required, ["group", "product_id", "name", "subscription_period", "price"]);
  assert.deepEqual(create?.input.properties.subscription_period?.enum, ["ONE_WEEK", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"]);
  assert.deepEqual(create?.input.properties.available_territories, { type: "string", description: "Where it is sold (default all)" });
  const list = tools.find((tool) => tool.words[0] === "list");
  assert.deepEqual(list?.positionals, ["asc_app"]);
  assert.equal(list?.effect, "read");
  assert.equal(tools.find((tool) => tool.words[0] === "delete")?.effect, "destructive");
  assert.equal(screenshots.mcp, false);
  assert.equal((await screenshots.tools())[0]?.effect, false);
  assert.equal(subscriptions.mcp, "write");
});

test("help lists the operations, and an operation's page its arguments, flags and choices", async () => {
  const page1 = await subscriptions.help([]);
  assert.match(page1, /create/);
  assert.match(page1, /list \[asc-app\]/);
  const create = await subscriptions.help(["create"]);
  assert.match(create, /required/);
  assert.match(create, /ONE_WEEK, ONE_MONTH/);
  assert.match(create, /--dry-run/);
  assert.doesNotMatch(create, /--yes/);
  const remove = await subscriptions.help(["delete"]);
  assert.match(remove, /<id>/);
  assert.match(remove, /--yes/);
  const list = await subscriptions.help(["list"]);
  assert.match(list, /\[asc-app\]/);
  assert.doesNotMatch(list, /--dry-run/);
});
