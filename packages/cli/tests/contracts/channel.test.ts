import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { onChannel, type Command } from "@/program/command";
import { renderCommand, renderRoot } from "@/program/help";
import { listGroups } from "@/commands/registry";

const original = process.env.SUPERWALL_CHANNEL;

afterEach(() => {
  process.env.SUPERWALL_CHANNEL = original;
});

function migrate(): Command {
  const found = listGroups()
    .flatMap((group) => group.commands)
    .find((command) => command.name === "migrate");
  assert.ok(found?.kind === "command", "migrate is registered");
  return found;
}

const rootHelp = () => stripVTControlCharacters(renderRoot(listGroups(), ""));

test("off the next channel, migrate is provider-only and the framework is absent from help", () => {
  delete process.env.SUPERWALL_CHANNEL;
  const command = migrate();
  assert.ok(!("paywall" in onChannel(command.args)));
  assert.ok(!("screen" in onChannel(command.flags)));
  assert.doesNotMatch(stripVTControlCharacters(renderCommand(command)), /--screen|paywall/);
  assert.doesNotMatch(rootHelp(), /Paywalls & funnels|^  create\s/m);
});

test("on the next channel, migrate rebuilds paywalls and screens and help lists the framework", () => {
  process.env.SUPERWALL_CHANNEL = "next";
  const command = migrate();
  assert.ok("paywall" in onChannel(command.args));
  assert.ok("screen" in onChannel(command.flags));
  assert.match(stripVTControlCharacters(renderCommand(command)), /--screen/);
  assert.match(rootHelp(), /Paywalls & funnels/);
  assert.match(rootHelp(), /^  create\s/m);
});
