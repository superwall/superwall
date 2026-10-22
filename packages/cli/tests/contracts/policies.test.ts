import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUPS } from "@/commands/registry";

const group = (id: string) => GROUPS.find((candidate) => candidate.id === id)?.commands ?? [];

test("every data command answers --json, and the reference pages need no login", () => {
  for (const id of ["main", "analytics", "api", "app-store-connect", "apple-search-ads"]) {
    for (const command of group(id)) {
      assert.equal(command.json, true, `${command.name} must take --json`);
      const reference = command.name.endsWith(" docs");
      assert.equal(command.auth, reference ? "none" : "required", `${command.name} auth`);
    }
  }
});

test("agent workflows stay human-only, and account and support commands answer --json", () => {
  for (const command of group("workflows")) assert.equal(command.json, false, command.name);
  for (const command of [...group("account"), ...group("support")].filter((candidate) => candidate.name !== "skills")) {
    assert.equal(command.json, true, command.name);
  }
});
