import assert from "node:assert/strict";
import { test } from "node:test";
import { parseParams } from "@/core/api/params";

test("parseParams reads nothing as an empty body", () => {
  assert.deepEqual(parseParams(undefined), {});
  assert.deepEqual(parseParams([]), {});
});

test("parseParams keeps key=value as a string and parses key:=value as JSON", () => {
  assert.deepEqual(parseParams(["name=Pro", "price:=9.99", "active:=true", "note=a=b", "tags:=[\"x\"]", "empty="]), {
    name: "Pro",
    price: 9.99,
    active: true,
    note: "a=b",
    tags: ["x"],
    empty: "",
  });
});

test("parseParams nests bracketed keys into objects and arrays", () => {
  assert.deepEqual(
    parseParams([
      "data[type]=subscriptions",
      "data[attributes][name]=Pro",
      "data[attributes][level]:=1",
      "items[0][id]=a",
      "items[1][id]=b",
      "items[0][qty]:=2",
      "ids[0]=x",
      "ids[1]=y",
    ]),
    {
      data: { type: "subscriptions", attributes: { name: "Pro", level: 1 } },
      items: [{ id: "a", qty: 2 }, { id: "b" }],
      ids: ["x", "y"],
    },
  );
});

test("parseParams refuses a pair without = and a typed value that isn't JSON", () => {
  assert.throws(() => parseParams(["name"]), {
    message: 'Invalid -d "name" - expected key=value (or key:=jsonValue).',
  });
  assert.throws(() => parseParams(["count:=ten"]), {
    message:
      'Invalid -d "count:=ten" - value after := must be JSON (number, true/false, null, "quoted", [...], {...}).',
  });
});
