import assert from "node:assert/strict";
import { test } from "node:test";
import { readState, interrupt, onInterrupt, reset, replaceActive } from "@/ui/ink/store";

test("an interrupt resolves the open prompt to null, records it, and tells the command", async () => {
  reset();
  const answered = new Promise<string | null>((resolve) =>
    replaceActive({
      type: "select",
      message: "Rebuild the pages now?",
      options: [{ value: "agent", label: "With Claude Code" }],
      index: 0,
      resolve,
    }),
  );
  let told = 0;
  const off = onInterrupt(() => {
    told += 1;
  });

  interrupt();

  assert.equal(await answered, null);
  assert.equal(readState().active, null);
  assert.equal(readState().items.at(-1)?.text, "Rebuild the pages now?\ncancelled");
  assert.equal(told, 1);

  off();
  interrupt();
  assert.equal(told, 1);
});

test("an interrupt during a spinner leaves the timeline alone and still tells the command", () => {
  reset();
  replaceActive({ type: "spinner", message: "Rebuilding" });
  let told = 0;
  const off = onInterrupt(() => {
    told += 1;
  });
  interrupt();
  assert.equal(told, 1);
  assert.deepEqual(readState().active, { type: "spinner", message: "Rebuilding" });
  assert.equal(readState().items.length, 0);
  off();
});
