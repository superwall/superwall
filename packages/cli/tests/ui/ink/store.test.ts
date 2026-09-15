import assert from "node:assert/strict";
import { test } from "node:test";
import { getState, interrupt, onInterrupt, reset, setActive } from "@/ui/ink/store";

test("an interrupt resolves the open prompt to null, records it, and tells the command", async () => {
  reset();
  const answered = new Promise<string | null>((resolve) =>
    setActive({
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
  assert.equal(getState().active, null);
  assert.equal(getState().items.at(-1)?.text, "Rebuild the pages now?\ncancelled");
  assert.equal(told, 1);

  off();
  interrupt();
  assert.equal(told, 1);
});

test("an interrupt during a spinner leaves the timeline alone and still tells the command", () => {
  reset();
  setActive({ type: "spinner", message: "Rebuilding" });
  let told = 0;
  const off = onInterrupt(() => {
    told += 1;
  });
  interrupt();
  assert.equal(told, 1);
  assert.deepEqual(getState().active, { type: "spinner", message: "Rebuilding" });
  assert.equal(getState().items.length, 0);
  off();
});
