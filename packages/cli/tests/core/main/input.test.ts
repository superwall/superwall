import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldName, readResourceFlags, textOf } from "@/core/main/input";

test("textOf reads a trimmed string or a number, and nothing else", () => {
  assert.equal(textOf("  pro  "), "pro");
  assert.equal(textOf(42), "42");
  assert.equal(textOf("   "), undefined);
  assert.equal(textOf(true), undefined);
  assert.equal(textOf(undefined), undefined);
});

test("a resource's own flags stay out of the fields sent to the API", () => {
  const flags = readResourceFlags({
    app: "10",
    project: "1",
    d: "note=hi",
    dryRun: true,
    yes: true,
    search: " pro ",
    limit: 5,
    version: "2",
    teamId: "ABC",
    bundleId: undefined,
    entitlement: "pro",
  });
  assert.deepEqual(flags, {
    search: "pro",
    limit: 5,
    yes: true,
    data: ["note=hi"],
    fields: { teamId: "ABC", entitlement: ["pro"] },
  });
});

test("repeatable flags stay lists, and absent ones are empty", () => {
  const flags = readResourceFlags({ d: ["a=1", "b=2"], entitlement: ["pro", 7], yes: "true" });
  assert.deepEqual(flags.data, ["a=1", "b=2"]);
  assert.deepEqual(flags.fields.entitlement, ["pro", "7"]);
  assert.equal(flags.yes, false);
  assert.deepEqual(readResourceFlags({ entitlement: null }).fields.entitlement, []);
  assert.deepEqual(readResourceFlags({}).data, []);
});

test("a flag's field name is its snake-case form", () => {
  assert.equal(fieldName("teamId"), "team_id");
  assert.equal(fieldName("redeemable-on-desktop"), "redeemable_on_desktop");
  assert.equal(fieldName("name"), "name");
});
