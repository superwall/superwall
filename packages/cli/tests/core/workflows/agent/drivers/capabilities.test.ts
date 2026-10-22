import assert from "node:assert/strict";
import { test } from "node:test";
import { toolsForCapabilities } from "@/core/workflows/agent/drivers/capabilities";

test("agent tool access is derived from independent capability axes", () => {
  assert.deepEqual(
    toolsForCapabilities({
      filesystem: "read",
      network: false,
      shell: "none",
    }),
    ["Read", "Glob", "Grep"],
  );
  assert.deepEqual(
    toolsForCapabilities({
      filesystem: "write",
      network: true,
      shell: "unrestricted",
    }),
    ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebFetch", "WebSearch"],
  );
  assert.deepEqual(toolsForCapabilities({ filesystem: "read", network: false, shell: "read-only" }), [
    "Read",
    "Glob",
    "Grep",
    "Bash",
  ]);
});
