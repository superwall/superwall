import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import fg from "fast-glob";
import { PLAYBOOKS, VENDORED_SKILLS } from "@/core/agent/skills";

test("bundled agent guidance treats JSON as the machine contract", () => {
  const files = ["prompts/commandments.xml", ...fg.sync("dist/skills/**/*.md")];
  const contents = files.map((file) => [file, readFileSync(file, "utf8")] as const);

  for (const [file, content] of contents) assert.doesNotMatch(content, /pk_PLACEHOLDER/, file);

  const commandments = readFileSync("prompts/commandments.xml", "utf8");
  assert.match(commandments, /pass --json for every data or mutation command/);
});

test("every bundled campaign creation supplies a placement and requests JSON", () => {
  for (const file of fg.sync("dist/skills/**/*.md")) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/superwall campaigns create ([^\n`]+)/g)) {
      const command = match[0].replace(/\\\s*$/, "");
      assert.match(command, /create\s+(?:"[^"]+"|'[^']+'|\S+)\s+\S+/, `${file}: ${command}`);
      assert.match(command, /--json\b/, `${file}: ${command}`);
    }
  }
});

test("the bundled skills match VENDORED_SKILLS exactly", () => {
  const dirs = fg.sync("dist/skills/*/SKILL.md").map((file) => file.split("/")[2]!).sort();
  assert.deepEqual(dirs, Object.keys(VENDORED_SKILLS).sort());
  for (const name of Object.keys(VENDORED_SKILLS)) {
    assert.match(readFileSync(`dist/skills/${name}/SKILL.md`, "utf8"), new RegExp(`^name: ${name}$`, "m"));
  }
  for (const [id, { playbook, refs }] of Object.entries(PLAYBOOKS)) {
    assert.ok(readFileSync(`dist/skills/${playbook}`, "utf8").length > 0, id);
    assert.ok(fg.sync(`dist/skills/${refs}/*.md`).length > 0, id);
  }
});
