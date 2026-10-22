import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "@/program/command";
import { createCommandOutput } from "@/program/output";
import { renderRows, renderValue, rowsOf } from "@/core/main/views";
import { said } from "../../helpers/answers";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

function context(json = false) {
  const calls: RendererCall[] = [];
  let stdout = "";
  const ui = recordingRenderer(calls);
  const output = createCommandOutput(json ? "json" : "rich", ui, {
    stdout: { write: (value) => ((stdout += String(value)), true) },
  });
  const ctx = { ui, output, json } as unknown as CommandContext;
  return { ctx, calls, printed: () => JSON.parse(stdout) as unknown };
}

const report = (calls: RendererCall[]) => said(calls, "report").join("\n");

test("rowsOf finds the rows wherever the API put them", () => {
  assert.deepEqual(rowsOf([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(rowsOf({ data: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(rowsOf({ versions: [{ id: 3 }], next: null }), [{ id: 3 }]);
  assert.deepEqual(rowsOf({ id: 4 }), [{ id: 4 }]);
  assert.deepEqual(rowsOf(null), []);
  assert.deepEqual(rowsOf(undefined), []);
});

test("a value is printed as aligned fields, with empty, yes/no and nested values made readable", () => {
  const { ctx, calls } = context();
  renderValue(
    ctx,
    {
      object: "product",
      id: "p1",
      name: null,
      note: "",
      active: true,
      archived: false,
      tags: ["a", "b"],
      many: Array.from({ length: 40 }, (_, i) => `entry-${i}`),
      none: [],
      price: { amount: 999, currency: "USD", meta: { deep: { deeper: 1 } } },
    },
    "Updated it",
  );
  assert.deepEqual(said(calls, "success"), ["Updated it"]);
  assert.equal(
    report(calls),
    [
      "id        p1",
      "name      —",
      "note      —",
      "active    yes",
      "archived  no",
      "tags      a, b",
      "many      40 items",
      "none      none",
      "price",
      "  amount    999",
      "  currency  USD",
      "  meta",
      "    deep  { 1 fields }",
    ].join("\n"),
  );
});

test("a list inside a value names its first rows and counts the rest", () => {
  const { ctx, calls } = context();
  const placements = Array.from({ length: 12 }, (_, i) => ({ id: i, event_name: `event_${i}` }));
  renderValue(ctx, {
    placements,
    audiences: [{ id: "a1", name: "a1" }, { id: "a2" }, "loose"],
    nested: { deeper: { rows: [{ id: 1 }] } },
  });
  const lines = report(calls).split("\n");
  assert.equal(lines[0], "placements  12 items");
  assert.equal(lines[1], "  · event_0  0");
  assert.equal(lines[10], "  · event_9  9");
  assert.equal(lines[11], "  … 2 more");
  assert.deepEqual(lines.slice(12, 15), ["audiences   3 items", "  · a1", "  · a2"]);
  assert.equal(lines.at(-1), "    rows  1 item");
});

test("a list or a bare value is printed as it is, and nothing is printed for nothing", () => {
  const list = context();
  renderValue(list.ctx, [{ id: 1, url: "https://example.com" }]);
  assert.equal(report(list.calls), "1 item\n  · https://example.com  1");

  const text = context();
  renderValue(text.ctx, "pong");
  assert.equal(report(text.calls), "pong");

  const empty = context();
  renderValue(empty.ctx, "", "Deleted it");
  assert.deepEqual(empty.calls.map((call) => call.method), ["success"]);
});

test("--json prints the value as the API sent it, or ok when it sent nothing", () => {
  const value = context(true);
  renderValue(value.ctx, { id: 1 });
  assert.deepEqual(value.printed(), { id: 1 });

  const nothing = context(true);
  renderValue(nothing.ctx, undefined, "Done");
  assert.deepEqual(nothing.printed(), { ok: true });
  assert.deepEqual(said(nothing.calls, "success"), []);
});

const ROWS = [
  { id: "p1", identifier: "pro_monthly", name: "Pro monthly" },
  { id: "p2", identifier: "pro_yearly" },
  { id: "p3", name: "p3" },
];

test("rows are listed by name with their identifier and id beside it", () => {
  const { ctx, calls } = context();
  renderRows(ctx, ROWS, "product", { limit: undefined });
  assert.deepEqual(said(calls, "step"), ["3 products"]);
  const list = calls.find((call) => call.method === "list")?.value as { items: unknown[]; empty: string };
  assert.deepEqual(list.items, [
    { label: "Pro monthly", meta: "pro_monthly  p1" },
    { label: "pro_yearly", meta: "p2" },
    { label: "p3", meta: undefined },
  ]);
  assert.equal(list.empty, "No products yet.");
});

test("--search narrows the rows and says of how many, and --limit caps them with a pointer to the rest", () => {
  const searched = context();
  renderRows(searched.ctx, ROWS, "product", { search: "yearly", limit: undefined });
  assert.deepEqual(said(searched.calls, "step"), ['1 product matching "yearly", of 3']);
  const empty = context();
  renderRows(empty.ctx, ROWS, "product", { search: "nope", limit: undefined });
  assert.equal((empty.calls.find((call) => call.method === "list")?.value as { empty: string }).empty, 'Nothing matches "nope".');

  const limited = context();
  renderRows(limited.ctx, ROWS, "product", { limit: 2 });
  assert.deepEqual(said(limited.calls, "info"), ["…1 more. Narrow with --search, or pass --limit or --json."]);
});

test("--json lists the matching rows, capped by --limit", () => {
  const { ctx, printed } = context(true);
  renderRows(ctx, ROWS, "product", { search: "pro", limit: 1 });
  assert.deepEqual(printed(), [ROWS[0]]);
});
