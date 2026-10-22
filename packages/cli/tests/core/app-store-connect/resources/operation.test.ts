import assert from "node:assert/strict";
import { test } from "node:test";
import { argOf, booleanOf, numberOf, plural, requireNumber, requireText, textOf, type AscInput } from "@/core/app-store-connect/resources/operation";

const input: AscInput = { args: { id: "1" }, flags: { name: "Pro", price: 9.99, familySharable: false }, yes: false };

test("the readers return typed values and name what is missing", () => {
  assert.equal(argOf(input, "id"), "1");
  assert.equal(textOf(input, "name"), "Pro");
  assert.equal(textOf(input, "price"), undefined);
  assert.equal(requireText(input, "name"), "Pro");
  assert.equal(numberOf(input, "price"), 9.99);
  assert.equal(requireNumber(input, "price"), 9.99);
  assert.equal(booleanOf(input, "familySharable"), false);
  assert.equal(booleanOf(input, "name"), undefined);
  assert.throws(() => argOf(input, "file"), /Missing <file>\./);
  assert.throws(() => requireText(input, "productId"), /Missing --product-id\./);
  assert.throws(() => requireNumber(input, "name"), /Missing --name\./);
});

test("plural counts nouns, including those ending in y", () => {
  assert.equal(plural(1, "territory"), "1 territory");
  assert.equal(plural(2, "territory"), "2 territories");
  assert.equal(plural(0, "price"), "0 prices");
});
