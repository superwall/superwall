import assert from "node:assert/strict";
import { test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { pushedLine, transition } from "@/commands/paywalls/pipeline";
import { promotePaywallVersion } from "@/core/api/resources";

interface Posted {
  path: string;
  body: unknown;
}

function fakeApi(posted: Posted[], reply: unknown = { version: 3, url: "u" }): SuperwallApi {
  const fake = {
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      return reply;
    },
  };
  return fake as unknown as SuperwallApi;
}

test("promote with no version asks for the latest, sending no version at all", async () => {
  const posted: Posted[] = [];
  await promotePaywallVersion(fakeApi(posted), "208540");

  assert.deepEqual(posted, [{ path: "/v2/paywalls/208540/promote", body: {} }]);
});

test("an older version than the one live is passed through verbatim — this is rollback", async () => {
  const posted: Posted[] = [];
  const promoted = await promotePaywallVersion(fakeApi(posted, { version: 3, url: "u" }), "208540", {
    version: 3,
  });

  assert.deepEqual(posted, [{ path: "/v2/paywalls/208540/promote", body: { version: 3 } }]);
  assert.equal(promoted.version, 3);
});

test("version 0 is still sent — it is a number, not an absent value", async () => {
  const posted: Posted[] = [];
  await promotePaywallVersion(fakeApi(posted), "208540", { version: 0 });

  assert.deepEqual(posted[0]?.body, { version: 0 });
});

test("the paywall id is escaped into the path", async () => {
  const posted: Posted[] = [];
  await promotePaywallVersion(fakeApi(posted), "a/b c");

  assert.equal(posted[0]?.path, "/v2/paywalls/a%2Fb%20c/promote");
});

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
