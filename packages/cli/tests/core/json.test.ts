import assert from "node:assert/strict";
import { test } from "node:test";
import { field, isRecord, listField, parseJson, textField } from "@/core/json";

test("field readers tolerate missing and malformed data", () => {
  assert.equal(parseJson(""), undefined);
  assert.equal(parseJson("<html>"), undefined);
  assert.equal(field(null, "a"), undefined);
  assert.equal(textField({ a: "  x " }, "a"), "x");
  assert.equal(textField({ a: " " }, "a"), undefined);
  assert.deepEqual(listField({ a: [1] }, "a"), [1]);
  assert.deepEqual(listField({ a: 1 }, "a"), []);
});

test("isRecord accepts plain objects only", () => {
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord("a"), false);
});
