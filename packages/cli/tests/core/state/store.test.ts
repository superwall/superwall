import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyStore, memoryStore, readJson } from "@/core/state/store";

test("a memory store keeps what is written until it is removed", () => {
  const store = memoryStore();
  assert.equal(store.read("config.json"), undefined);
  store.write("config.json", '{"a":1}');
  assert.deepEqual(readJson(store, "config.json"), { a: 1 });
  store.remove("config.json");
  assert.equal(store.read("config.json"), undefined);
});

test("the empty store remembers nothing", () => {
  emptyStore.write("auth.json", "{}");
  emptyStore.remove("auth.json");
  assert.equal(emptyStore.read("auth.json"), undefined);
});

test("a file that isn't JSON reads as missing", () => {
  const store = memoryStore();
  store.write("api-index.json", "{ not json");
  assert.equal(readJson(store, "api-index.json"), undefined);
});
