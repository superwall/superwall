import assert from "node:assert/strict";
import { test } from "node:test";
import { plainRenderer } from "@/ui/plain/renderer";

test("plain output has no glyphs, gutters, ANSI, or spinner chatter", async () => {
  let stdout = "";
  let stderr = "";
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = ((value: string | Uint8Array) => (
    (stdout += String(value)), true
  )) as typeof process.stdout.write;
  process.stderr.write = ((value: string | Uint8Array) => (
    (stderr += String(value)), true
  )) as typeof process.stderr.write;

  try {
    plainRenderer.intro("**Paywalls** in `My App`");
    const spinner = plainRenderer.spinner();
    spinner.start("Loading");
    spinner.stop("Loaded");
    plainRenderer.list({
      items: [{ label: "Delta Friend Zone", meta: "243035" }],
    });
    plainRenderer.error("\u001b[31mFailed\u001b[39m");

    assert.equal(stdout, "Paywalls in My App\nDelta Friend Zone  243035\n");
    assert.equal(stderr, "Failed\n");
    assert.doesNotMatch(stdout + stderr, /[◆◇●│→✓`*\u001b]/);
    assert.equal(
      await plainRenderer.select({
        message: "Pick",
        options: [{ label: "One", value: "1" }],
      }),
      null,
    );
    assert.equal(await plainRenderer.confirm({ message: "Proceed?" }), null);
    assert.equal(await plainRenderer.text({ message: "Name" }), null);
    assert.equal(
      await plainRenderer.multiselect({
        message: "Pick",
        options: [{ label: "One", value: "1" }],
      }),
      null,
    );
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
});
