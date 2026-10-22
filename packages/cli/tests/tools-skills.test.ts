import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryStore } from "@/core/state/store";

process.env.SUPERWALL_TOOLS_SKILLS = JSON.stringify({
  "superwall/references/asc.md": "# App Store Connect\n\nKeys and products.",
  "superwall/SKILL.md": "---\nname: superwall\ndescription: Use the superwall CLI and MCP.\n---\n\n# Superwall",
});
const { instructions, listSkills, listTools, readSkill, useToolCache } = await import("@/tools");
const cache = memoryStore();
cache.write("api-index.json", JSON.stringify({ version: "test", fetchedAt: Date.now(), operations: [] }));
useToolCache(cache);

test("bundled skill files are resources, SKILL.md first, described by their front matter or heading", () => {
  assert.deepEqual(
    listSkills().map(({ uri, description }) => [uri, description]),
    [
      ["skill://superwall/SKILL.md", "Use the superwall CLI and MCP."],
      ["skill://superwall/references/asc.md", "App Store Connect"],
    ],
  );
  assert.equal(readSkill("skill://superwall/references/asc.md")?.text, "# App Store Connect\n\nKeys and products.");
  assert.equal(readSkill("skill://superwall/nope.md"), undefined);
});

test("the skill tool comes first, reads SKILL.md by default and any bundled file by name", async () => {
  const [first] = await listTools();
  assert.equal(first?.name, "skill");
  assert.equal(first?.annotations.readOnlyHint, true);
  assert.deepEqual(first?.inputSchema.properties.file?.enum, ["superwall/SKILL.md", "superwall/references/asc.md"]);
  const api = {} as never;
  assert.deepEqual((await first!.run({}, api)).data, { file: "superwall/SKILL.md", text: listSkills()[0]!.text });
  assert.equal(((await first!.run({ file: "superwall/references/asc.md" }, api)).data as { file: string }).file, "superwall/references/asc.md");
  assert.equal((await first!.run({ file: "missing.md" }, api)).ok, false);
});

test("the instructions send the agent to the skill first", () => {
  assert.match(instructions(), /Read the skill tool first/);
});
