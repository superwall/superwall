import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { mintHashcash } from "@/core/apple/hashcash";

test("mints a stamp with the requested leading zero bits", () => {
  for (const bits of [8, 11]) {
    const stamp = mintHashcash(bits, "challenge-abc", new Date(Date.UTC(2026, 9, 8, 7, 6, 5)));
    assert.match(stamp, new RegExp(`^1:${bits}:20261008070605:challenge-abc::\\d+$`));
    const sum = createHash("sha1").update(stamp).digest();
    const leading = [...sum].map((byte) => byte.toString(2).padStart(8, "0")).join("");
    assert.equal(leading.slice(0, bits), "0".repeat(bits));
  }
});
