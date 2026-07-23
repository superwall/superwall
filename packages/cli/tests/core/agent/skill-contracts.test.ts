import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import fg from "fast-glob";

test("bundled agent guidance treats JSON as the machine contract", () => {
  const files = ["prompts/commandments.xml", ...fg.sync("skills/**/*.md")];
  const contents = files.map((file) => [file, readFileSync(file, "utf8")] as const);

  for (const [file, content] of contents) assert.doesNotMatch(content, /pk_PLACEHOLDER/, file);

  const commandments = readFileSync("prompts/commandments.xml", "utf8");
  assert.match(commandments, /pass --json for every data or mutation command/);
});

test("every bundled campaign creation supplies a placement and requests JSON", () => {
  for (const file of fg.sync("skills/**/*.md")) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/superwall campaigns create ([^\n`]+)/g)) {
      const command = match[0].replace(/\\\s*$/, "");
      assert.match(command, /create\s+(?:"[^"]+"|'[^']+'|\S+)\s+\S+/, `${file}: ${command}`);
      assert.match(command, /--json\b/, `${file}: ${command}`);
    }
  }
});
