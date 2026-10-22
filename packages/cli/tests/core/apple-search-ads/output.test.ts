import assert from "node:assert/strict";
import { test } from "node:test";
import { asaVariants, type AsaOperation } from "@/core/apple-search-ads/catalog";
import type { AsaPage } from "@/core/apple-search-ads/operations";
import { listOf, printResult } from "@/core/apple-search-ads/output";
import { defineCommand } from "@/program/command";
import { runCommand } from "../../helpers/command";

const opOf = (group: string, action: string): AsaOperation => {
  const [op] = asaVariants(group, action);
  assert.ok(op);
  return op;
};

const print = (op: AsaOperation, response: AsaPage, json = false) =>
  runCommand(
    defineCommand({
      name: "asa print",
      summary: "Probe",
      examples: [["asa print", "Probe"]],
      auth: "none",
      json: true,
      prompts: false,
      mcp: "read",
      run(ctx) {
        printResult(ctx, op, response);
      },
    }),
    { json },
  );

test("listOf reads nothing, one value, or many as strings", () => {
  assert.deepEqual(listOf(undefined), []);
  assert.deepEqual(listOf(null), []);
  assert.deepEqual(listOf("a=1"), ["a=1"]);
  assert.deepEqual(listOf(["a=1", 2]), ["a=1", "2"]);
});

test("a listing prints one row per item, labelled by the best name it has", async () => {
  const result = await print(opOf("keywords", "list"), {
    data: [
      { text: "photo editor", status: "ACTIVE", matchType: "EXACT", bidAmount: { amount: "1.5", currency: "USD" }, id: 7 },
      { name: "", appName: "Acme", adamId: 99, dailyBudgetAmount: { amount: 5 } },
      { orgId: 3, defaultBidAmount: { currency: "USD" } },
      { status: "", servingStatus: "RUNNING" },
      "not a row",
    ],
  });
  assert.deepEqual(result.said("step"), ["4 keywords"]);
  assert.deepEqual(result.said("info"), [
    "`photo editor`  ACTIVE  EXACT  1.5 USD  7",
    "`Acme`  5  99",
    "``  3",
    "``  RUNNING",
  ]);
});

test("a page of a longer listing says how many there are in all", async () => {
  const result = await print(opOf("campaigns", "find"), {
    data: [{ id: 1 }],
    pagination: { totalResults: 12 },
  });
  assert.deepEqual(result.said("step"), ["1 of 12 campaigns"]);
  assert.deepEqual(result.said("info"), ["`1`  1"]);
  const all = await print(opOf("campaigns", "list"), { data: [{ id: 1 }], pagination: { totalResults: 1 } });
  assert.deepEqual(all.said("step"), ["1 campaigns"]);
});

test("anything that isn't a listing is shown whole, and --json is always Apple's answer", async () => {
  const single = await print(opOf("campaigns", "get"), { data: [{ id: 1 }] });
  assert.deepEqual(single.said("step"), []);
  assert.equal(single.said("report").length, 1);
  const object = await print(opOf("campaigns", "list"), { data: { id: 1 } });
  assert.equal(object.said("report").length, 1);
  const json = await print(opOf("campaigns", "list"), { data: [{ id: 1 }] }, true);
  assert.deepEqual(json.json, { data: [{ id: 1 }] });
});
