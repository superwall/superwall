import assert from "node:assert/strict";
import { test } from "node:test";
import { executeCommand } from "@/command";
import { runAsc } from "@/commands/asc";
import type { SuperwallApi } from "@/core/api/client";
import { recordingRenderer } from "../helpers/renderer";

test("asc keys list honors --json without UI contamination", async () => {
  const api = {
    org: { id: "org-1" },
    get: async (path: string) => {
      assert.equal(path, "/v2/organizations/org-1/app-store-connect");
      return { data: [{ id: "team-1", name: "Primary" }] };
    },
  } as unknown as SuperwallApi;
  let stdout = "";
  const calls: Array<{ method: string }> = [];

  await executeCommand(
    runAsc.definition,
    { _: [], $0: "superwall", target: "keys", value: "list", json: true },
    {
      api: () => api,
      renderer: () => recordingRenderer(calls),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );

  assert.deepEqual(JSON.parse(stdout), [{ id: "team-1", name: "Primary" }]);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["start", "stop"],
  );
});
