import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { escapeExact, fence, FORMAT_VERSION, inline, markResult, neutralize, unescapeExact, unmark, type Author, type Policy } from "@/core/untrusted/text";

// src/core/untrusted/text.ts is a byte-identical copy of superwall/paywall-next's
// packages/untrusted-text/src/index.ts, which the Superwall API uses for its own agent-facing output.
// The fixture is that package's vectors.json, copied with it. It pins the file's SHA-256
// and what each function makes of each input, so an agent reads one format from
// both. To change the format: change it there, regenerate the vectors, copy both files.

interface Vectors {
  format: number;
  source_sha256: string;
  fence_id: string;
  neutralize: { name: string; input: string; output: string }[];
  inline: { name: string; input: string | null; output: string }[];
  fence: { name: string; author: Author; text: string; label?: string; maxChars?: number; cutNote?: string; output: string }[];
  exact: { name: string; input: string; output: string }[];
  unmark: { name: string; input: string; output: string }[];
  json: { name: string; policy?: Policy; input: unknown; value: unknown; text: string; preamble: string | null }[];
}

const vectors: Vectors = JSON.parse(readFileSync(new URL("./fixtures/untrusted-text-vectors.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../src/core/untrusted/text.ts", import.meta.url));
const fenceId = vectors.fence_id;

test("the copy is the file the vectors were made from", () => {
  assert.equal(vectors.format, FORMAT_VERSION);
  assert.equal(createHash("sha256").update(source).digest("hex"), vectors.source_sha256);
  assert.match(source.toString("utf8"), /^[\x20-\x7E\n]*$/, "plain ASCII, so the bytes are the same everywhere");
});

test("neutralize removes what lets text pass for structure", () => {
  for (const vector of vectors.neutralize) assert.equal(neutralize(vector.input, fenceId), vector.output, vector.name);
});

test("inline puts a value on one quoted line", () => {
  for (const vector of vectors.inline) assert.equal(inline(vector.input, fenceId), vector.output, vector.name);
});

test("fence holds text on prefixed lines between lines that carry the id", () => {
  for (const { name, output, ...input } of vectors.fence) assert.equal(fence({ ...input, fenceId }), output, name);
});

test("an exact value shows what hides and comes back unchanged", () => {
  for (const vector of vectors.exact) {
    assert.equal(escapeExact(vector.input), vector.output, vector.name);
    assert.equal(unescapeExact(vector.output), vector.input, vector.name);
  }
});

test("unmark takes our marks off and leaves everything else", () => {
  for (const vector of vectors.unmark) assert.equal(unmark(vector.input), vector.output, vector.name);
});

test("a JSON result is marked by its policy, rules first", () => {
  for (const vector of vectors.json) {
    const result = markResult(vector.input, { fenceId, policy: vector.policy, indent: 2 });
    assert.deepEqual(result.value, vector.value, vector.name);
    assert.equal(result.text, vector.text, vector.name);
    assert.equal(result.preamble, vector.preamble, vector.name);
  }
});
