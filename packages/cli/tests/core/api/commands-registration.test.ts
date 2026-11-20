import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCommandLookup } from "@/core/api/commands";

test("before any command list is registered the lookup throws rather than finding no command", () => {
  assert.throws(() => resolveCommandLookup(), /command registry isn't loaded/);
});

test("loading the registry registers its command list with the lookup", async () => {
  await import("@/commands/registry");
  assert.equal(resolveCommandLookup()({ method: "GET", path: "/v2/campaigns/{id}" }), "superwall campaigns get <campaign>");
});
