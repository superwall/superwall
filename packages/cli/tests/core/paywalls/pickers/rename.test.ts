import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pickRenameOption } from "@/core/paywalls/pickers/rename";
import { RenameError, type RenameOrphan } from "@/core/paywalls/binding/renames";
import type { FrameworkSurface } from "@/core/paywalls/project/framework";
import { ui, type SelectOpts } from "@/ui";

const newcomer: FrameworkSurface = {
  kind: "paywall",
  id: "pro-upgrade",
  dir: "/tmp/pro-upgrade",
  configFile: "/tmp/pro-upgrade/config.ts",
  routes: [],
};

const orphans: RenameOrphan[] = [
  { kind: "paywall", id: "plus-upgrade", bindings: { ios: { paywallId: "1" }, android: { paywallId: "2" } } },
  { kind: "paywall", id: "gold-upgrade", bindings: { ios: { paywallId: "3" } } },
];

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

test("each orphan is offered with every app's paywall as the hint, then create", async () => {
  const asked = answering(() => "plus-upgrade");

  const decision = await pickRenameOption({ newcomer, orphans });

  assert.deepEqual(decision, { kind: "rename", orphanId: "plus-upgrade" });
  assert.match(asked[0]?.message ?? "", /`pro-upgrade` is not in superwall\.lock/);
  assert.deepEqual(
    asked[0]?.options.map((option) => [option.label, option.hint]),
    [
      ["Renamed from plus-upgrade", "paywalls 1 (ios), 2 (android)"],
      ["Renamed from gold-upgrade", "paywall 3"],
      ["Create a new paywall", undefined],
    ],
  );
});

test("choosing create is a create decision", async () => {
  answering((opts) => opts.options.at(-1)?.value ?? null);
  assert.deepEqual(await pickRenameOption({ newcomer, orphans }), { kind: "create" });
});

test("cancelling aborts with the lock untouched", async () => {
  answering(() => null);
  await assert.rejects(
    pickRenameOption({ newcomer, orphans }),
    (error: Error) => error instanceof RenameError && /superwall\.lock is unchanged/.test(error.message),
  );
});
