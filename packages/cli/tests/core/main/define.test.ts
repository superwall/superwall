import assert from "node:assert/strict";
import { test } from "node:test";
import { defineResource } from "@/core/main/define";

const gadgets = defineResource({
  name: "gadgets",
  summary: "Gadgets",
  operations: [
    { name: "list", summary: "All", effect: "read", handler: "resource" },
    { name: "get", summary: "One", effect: "read", method: "GET", path: "/v2/gadgets/{id}" },
  ],
  nested: [{ name: "parts", summary: "Parts", operations: [{ name: "create", summary: "Add", effect: "write", method: "POST", path: "/v2/gadgets/{id}/parts" }] }],
  examples: [["gadgets get <gadget>", "One"]],
});

test("a resource is a catalog that takes the API's flags and asks for a login", () => {
  assert.equal(gadgets.kind, "catalog");
  assert.equal(gadgets.name, "gadgets");
  assert.equal(gadgets.auth, "required");
  assert.equal(gadgets.json, true);
});

test("its operations list names nested resources as their own family", () => {
  assert.deepEqual(gadgets.operations(), ["list", "get", "parts …"]);
});
