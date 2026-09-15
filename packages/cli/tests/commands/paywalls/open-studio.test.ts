import assert from "node:assert/strict";
import { test } from "node:test";
import { askStudio, migrationNextSteps } from "@/commands/paywalls/open-studio";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

test("the studio is never offered without someone at the terminal", async () => {
  const calls: RendererCall[] = [];
  assert.equal(await askStudio(recordingRenderer(calls), false, "force-update"), false);
  assert.equal(calls.length, 0);
});

test("declining the offer is a no", async () => {
  const calls: RendererCall[] = [];
  assert.equal(await askStudio(recordingRenderer(calls), true, "force-update"), false);
  const confirm = calls.find((call) => call.method === "confirm");
  assert.match(String((confirm?.value as { message: string }).message), /paywall\/force-update next to the original/);
});

test("the next steps follow the answers: studio opening, or how to open it; tweaks before pushing", () => {
  const opening = migrationNextSteps(true, "superwall", "255456", "agent");
  assert.equal(opening.length, 3);
  assert.match(opening[0] ?? "", /opens on the rebuilt paywall with the original beside it/);
  assert.match(opening[1] ?? "", /ask your agent to tweak/);
  assert.match(opening[2] ?? "", /^Push when it's right/);

  const later = migrationNextSteps(false, ".", "255456", "later");
  assert.equal(later.length, 4);
  assert.match(later[0] ?? "", /^superwall migrate 255456/);
  assert.match(later[1] ?? "", /Run `superwall dev` in \.,.*Compare › Original/);

  const copied = migrationNextSteps(false, "superwall", "255456", "copy");
  assert.equal(copied.length, 3);
  assert.match(copied[0] ?? "", /superwall dev` in superwall/);
});
