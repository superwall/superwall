import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pickStaleOption } from "@/core/paywalls/pickers/stale";
import { RenameError, type RenameOrphan } from "@/core/paywalls/binding/renames";
import { ui, type SelectOpts } from "@/ui";

const ORPHAN: RenameOrphan = {
  kind: "paywall",
  id: "pro-upgrade",
  bindings: { ios: { paywallId: "208540" } },
};

const realSelect = ui.select;

afterEach(() => {
  ui.select = realSelect;
});

function answering(pick: (opts: SelectOpts) => string | null): SelectOpts[] {
  const asked: SelectOpts[] = [];
  ui.select = async (opts: SelectOpts) => {
    asked.push(opts);
    return pick(opts);
  };
  return asked;
}

test("the prompt says removing forgets it locally, not on Superwall", async () => {
  const asked = answering((opts) => opts.options[0]?.value ?? null);

  await pickStaleOption(ORPHAN);

  const message = asked[0]?.message ?? "";
  assert.match(message, /`pro-upgrade` is bound to paywall 208540 but no longer exists on disk/);
  assert.match(message, /only forgets it locally/);
  assert.match(message, /stays on Superwall/);
  assert.match(message, /keeps serving devices/);
  assert.doesNotMatch(message, /delete|deleted|removed from Superwall/i);
});

test("removing is the default, and the options say what each one costs", async () => {
  const asked = answering((opts) => opts.options[0]?.value ?? null);

  await pickStaleOption(ORPHAN);

  const opts = asked[0];
  assert.equal(opts?.options[0]?.label, "Remove the binding");
  assert.equal(opts?.initialValue, opts?.options[0]?.value);
  assert.match(opts?.options[0]?.hint ?? "", /re-binds it on the next push/);
  assert.equal(opts?.options[1]?.label, "Keep it");
});

test("each option maps to its decision", async () => {
  answering((opts) => opts.options[0]?.value ?? null);
  assert.equal(await pickStaleOption(ORPHAN), "remove");

  answering((opts) => opts.options[1]?.value ?? null);
  assert.equal(await pickStaleOption(ORPHAN), "keep");
});

test("cancelling touches nothing and stops the run", async () => {
  answering(() => null);

  await assert.rejects(
    pickStaleOption(ORPHAN),
    (error: Error) => error instanceof RenameError && /superwall.lock is unchanged/.test(error.message),
  );
});
