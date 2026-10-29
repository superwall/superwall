import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine } from "../../../helpers/command";

test("overwrite and rollout metadata does not advertise confirmation for handlers that never prompt", async () => {
  for (const operation of [
    "metadata update", "release submit", "release phased", "versions update",
    "availability set", "iaps update", "localizations update", "offers create",
    "offers update", "prices set", "subscription-groups update", "subscriptions update",
  ]) {
    const help = await helpLine(`asc ${operation} --help`);
    assert.doesNotMatch(help, /--yes|Go ahead without asking/, operation);
    assert.match(help, /--dry-run/, operation);
  }
});

test("handlers that confirm still advertise how to skip their prompt", async () => {
  for (const operation of [
    "release release", "iaps delete", "subscription-groups delete", "subscriptions delete",
    "builds attach", "builds expire", "offers delete", "versions delete", "localizations delete",
  ]) {
    const help = await helpLine(`asc ${operation} --help`);
    assert.match(help, /-y, --yes\s+Go ahead without asking/, operation);
  }
});
