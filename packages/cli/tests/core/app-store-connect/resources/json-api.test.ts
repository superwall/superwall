import assert from "node:assert/strict";
import { test } from "node:test";
import { attribute, compact, selectIncluded, linkTo, linkToMany, numberAttribute, parseDocument, relatedId } from "@/core/app-store-connect/resources/json-api";

test("a document is read leniently: lists, one resource, included, Apple's next link as a path", () => {
  const list = parseDocument({
    data: [{ id: "1", type: "t", attributes: { name: "A", n: 2 }, relationships: { group: { data: { type: "g", id: "G" } } } }, { id: 2 }, "x"],
    included: [{ id: "G", type: "g" }],
    links: { next: "https://api.appstoreconnect.apple.com/v1/things?cursor=A" },
  });
  assert.equal(list.data.length, 1);
  assert.equal(list.one, null);
  assert.equal(list.next, "/v1/things?cursor=A");
  const [first] = list.data;
  assert.ok(first);
  assert.equal(attribute(first, "name"), "A");
  assert.equal(attribute(first, "n"), undefined);
  assert.equal(numberAttribute(first, "n"), 2);
  assert.equal(numberAttribute(first, "name"), undefined);
  assert.equal(relatedId(first, "group"), "G");
  assert.equal(relatedId(first, "app"), undefined);
  assert.equal(selectIncluded(list, "g", "G")?.id, "G");

  const single = parseDocument({ data: { id: "9" } });
  assert.deepEqual(single.one, { id: "9", type: "", attributes: {}, relationships: {} });
  assert.deepEqual(parseDocument(undefined), { data: [], one: null, included: [] });
  assert.deepEqual(parseDocument({ data: null, links: "x", meta: { paging: 1 } }), { data: [], one: null, included: [] });
});

test("bodies are built from small pieces", () => {
  assert.deepEqual(linkTo("apps", "1"), { data: { type: "apps", id: "1" } });
  assert.deepEqual(linkToMany("territories", ["USA"]), { data: [{ type: "territories", id: "USA" }] });
  assert.deepEqual(compact({ a: 1, b: undefined, c: null }), { a: 1, c: null });
});
