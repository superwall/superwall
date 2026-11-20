import assert from "node:assert/strict";
import { test } from "node:test";
import { listGroups } from "@/commands/registry";
import { resolveCommandLookup, useCommandList, withCommand } from "@/core/api/commands";

test("an endpoint a resource operation covers maps to that command, nested or not", () => {
  const lookup = resolveCommandLookup();
  assert.equal(lookup({ method: "PUT", path: "/v2/campaigns/{id}/audiences/order" }), "superwall campaigns audiences reorder <campaign>");
  assert.equal(lookup({ method: "PUT", path: "/v2/campaigns/{id}/audiences/{audience_id}/weights" }), "superwall campaigns variants weights <campaign> <audience>");
  assert.equal(lookup({ method: "GET", path: "/v2/campaigns/{id}" }), "superwall campaigns get <campaign>");
});

test("an endpoint no resource covers has no command", () => {
  const lookup = resolveCommandLookup();
  assert.equal(lookup({ method: "DELETE", path: "/v2/campaigns/{id}/audiences/order" }), undefined);
  assert.equal(lookup({ method: "GET", path: "/v2/nowhere" }), undefined);
});

test("withCommand adds the command only when there is one", () => {
  const lookup = resolveCommandLookup();
  assert.deepEqual(withCommand({ method: "PUT", path: "/v2/campaigns/{id}/audiences/order" }, lookup), {
    method: "PUT",
    path: "/v2/campaigns/{id}/audiences/order",
    command: "superwall campaigns audiences reorder <campaign>",
  });
  assert.deepEqual(withCommand({ method: "GET", path: "/v2/nowhere" }, lookup), { method: "GET", path: "/v2/nowhere" });
});

test("a command list handed over replaces the one before", () => {
  useCommandList(() => []);
  assert.equal(resolveCommandLookup()({ method: "GET", path: "/v2/campaigns/{id}" }), undefined);
  useCommandList(() => listGroups().flatMap((group) => group.commands));
  assert.equal(resolveCommandLookup()({ method: "GET", path: "/v2/campaigns/{id}" }), "superwall campaigns get <campaign>");
});
