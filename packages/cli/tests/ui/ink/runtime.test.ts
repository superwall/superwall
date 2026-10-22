import assert from "node:assert/strict";
import { test } from "node:test";
import { inkRenderer } from "@/ui/ink/runtime";
import { readState, reset } from "@/ui/ink/store";

test("text prompts can start with an editable value", () => {
  reset();
  void inkRenderer.text({
    message: "Name the iOS app",
    initialValue: "Monoroll",
  });

  const active = readState().active;
  assert.equal(active?.type, "text");
  if (active?.type === "text") assert.equal(active.value, "Monoroll");
  reset();
});

test("secret text prompts carry the flag to the active prompt", () => {
  reset();
  void inkRenderer.text({ message: "Apple Account password", secret: true });

  const active = readState().active;
  assert.equal(active?.type, "text");
  if (active?.type === "text") assert.equal(active.secret, true);
  reset();
});
