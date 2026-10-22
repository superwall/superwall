import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pickApplicationOption } from "@/core/paywalls/pickers/application";
import type { Application } from "@/core/api/resources";
import { ui, type SelectOpts } from "@/ui";

const APPS: Application[] = [
  { id: 1, name: "Puzzler", platform: "ios" },
  { id: 2, bundle_id: "com.puzzler.android", platform: "android" },
  { id: 3 },
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

test("without an alias it asks which app the paywalls belong to", async () => {
  const asked = answering(() => "1");

  const picked = await pickApplicationOption(APPS);

  assert.equal(picked?.id, 1);
  assert.match(asked[0]?.message ?? "", /Which app do these paywalls belong to\?/);
});

test("with a platform it asks which app of that platform, and says the answer lands in the lock", async () => {
  const asked = answering(() => "2");

  const picked = await pickApplicationOption(APPS, "android");

  assert.equal(picked?.id, 2);
  assert.match(asked[0]?.message ?? "", /Which Android app do these paywalls push to\?/);
  assert.match(asked[0]?.message ?? "", /superwall\.lock/);
});

test("options are labelled by name, then bundle id, then id, with the platform as a hint", async () => {
  const asked = answering(() => null);

  assert.equal(await pickApplicationOption(APPS), null);

  assert.deepEqual(
    asked[0]?.options.map((option) => [option.value, option.label, option.hint]),
    [
      ["1", "Puzzler", "iOS"],
      ["2", "com.puzzler.android", "Android"],
      ["3", "3", "?"],
    ],
  );
});

test("an answer that names no listed app picks nothing", async () => {
  answering(() => "99");

  assert.equal(await pickApplicationOption(APPS), null);
});
