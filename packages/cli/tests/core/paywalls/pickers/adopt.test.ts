import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AdoptCandidate } from "@/core/paywalls/binding/binding";
import { pickAdoptOption } from "@/core/paywalls/pickers/adopt";
import { ui, type SelectOpts } from "@/ui";

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

const candidate: AdoptCandidate = {
  surface: { kind: "paywall", id: "plus-upgrade", dir: "/tmp/p", configFile: "/tmp/p/config.ts", routes: [] },
  paywallId: "208540",
  applicationId: "42",
  platform: "ios",
};

test("it explains the unbound paywall it found and defaults to stopping", async () => {
  const asked = answering((opts) => String(opts.initialValue));

  assert.equal(await pickAdoptOption(candidate), false);

  assert.equal(
    asked[0]?.message,
    "App 42 already has a paywall `plus-upgrade` (208540), and superwall.lock doesn't bind it. It may belong to someone else in this app.",
  );
  assert.deepEqual(
    asked[0]?.options.map((option) => [option.label, option.hint]),
    [
      ["Stop", "rename the directory to push as a new paywall"],
      ["Push to paywall 208540", "it's mine — bind it in superwall.lock"],
    ],
  );
});

test("choosing the paywall adopts it, and cancelling does not", async () => {
  answering((opts) => String(opts.options[1]?.value));
  assert.equal(await pickAdoptOption(candidate), true);

  answering(() => null);
  assert.equal(await pickAdoptOption(candidate), false);
});
