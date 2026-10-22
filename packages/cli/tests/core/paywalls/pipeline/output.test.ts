import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingPromoteWarning, pushedLine, transition } from "@/core/paywalls/pipeline/output";

const plain = (text: string): string => text.replace(/\[[0-9;]*m/g, "");

test("moving forward reads as a promotion, with both ends of the move", () => {
  assert.equal(plain(transition(10, 11)), "Promoted version 10 → 11");
});

test("moving backward reads as a rollback, not a promotion", () => {
  assert.equal(plain(transition(11, 10)), "Rolled back version 11 → 10");
});

test("promoting what is already live claims no change", () => {
  assert.equal(plain(transition(11, 11)), "Version 11 already live");
});

test("an unknown live version falls back to the single-version line", () => {
  assert.equal(plain(transition(undefined, 11)), "Promoted version 11");
});

test("version 0 is a live version like any other, never treated as absent", () => {
  assert.equal(plain(transition(0, 1)), "Promoted version 0 → 1");
  assert.equal(plain(transition(1, 0)), "Rolled back version 1 → 0");
});

const SNAPSHOT = "ac4e644d1f0b9c7e2a";

test("a push shows the snapshot sha and what is still live behind it", () => {
  assert.equal(
    plain(pushedLine({ version: 12, snapshotId: SNAPSHOT, live: 10, promoting: false })),
    "Pushed version 12 (ac4e644) · live 10",
  );
});

test("a publish drops the live context — its own promote line carries the move", () => {
  assert.equal(
    plain(pushedLine({ version: 12, snapshotId: SNAPSHOT, live: 10, promoting: true })),
    "Pushed version 12 (ac4e644)",
  );
});

test("nothing live yet leaves the version line alone", () => {
  assert.equal(
    plain(pushedLine({ version: 1, snapshotId: SNAPSHOT, promoting: false })),
    "Pushed version 1 (ac4e644)",
  );
});

test("live version 0 is still shown — it is a version, not an absent value", () => {
  assert.equal(
    plain(pushedLine({ version: 1, snapshotId: SNAPSHOT, live: 0, promoting: false })),
    "Pushed version 1 (ac4e644) · live 0",
  );
});

test("a missing or stub snapshot id drops the sha rather than printing a partial one", () => {
  assert.equal(plain(pushedLine({ version: 12, promoting: false })), "Pushed version 12");
  assert.equal(
    plain(pushedLine({ version: 12, snapshotId: "abc", promoting: false })),
    "Pushed version 12",
  );
});

test("pendingPromoteWarning: silent when empty, a sentence for one, a list for many", () => {
  assert.equal(pendingPromoteWarning([]), undefined);

  assert.equal(
    pendingPromoteWarning(["plus-upgrade"]),
    "plus-upgrade is pushed but not live — run `superwall promote --id plus-upgrade` to publish it.",
  );

  const many = pendingPromoteWarning(["a", "b"]);
  assert.equal(
    many,
    [
      "These 2 paywalls are pushed but not live:",
      "  a",
      "  b",
      "",
      "  superwall promote --id a,b",
    ].join("\n"),
  );

  const lots = pendingPromoteWarning(Array.from({ length: 13 }, (_, i) => `p${i}`));
  assert.match(lots ?? "", /…and 3 more/, "the list is capped");
  assert.match(lots ?? "", /--id p0,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12/, "the command is not");
});

test("pending hints name the platform when the project has several, and pass --platform when they share one", () => {
  assert.equal(
    pendingPromoteWarning([{ id: "plus-upgrade", platform: "ios" }], true),
    "plus-upgrade · ios is pushed but not live — run `superwall promote --id plus-upgrade --platform ios` to publish it.",
  );
  assert.equal(
    pendingPromoteWarning(
      [
        { id: "plus-upgrade", platform: "ios" },
        { id: "plus-upgrade", platform: "android" },
      ],
      true,
    ),
    [
      "These 2 paywalls are pushed but not live:",
      "  plus-upgrade · ios",
      "  plus-upgrade · android",
      "",
      "  superwall promote --id plus-upgrade",
    ].join("\n"),
  );
  assert.equal(
    pendingPromoteWarning([{ id: "plus-upgrade", platform: "ios" }], false),
    "plus-upgrade is pushed but not live — run `superwall promote --id plus-upgrade` to publish it.",
  );
});
