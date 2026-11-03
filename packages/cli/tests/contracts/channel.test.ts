import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { onChannel, summaryOf, type Command } from "@/program/command";
import { renderCommand, renderRoot } from "@/program/help";
import { listGroups } from "@/commands/registry";

const original = process.env.SUPERWALL_CHANNEL;

afterEach(() => {
  process.env.SUPERWALL_CHANNEL = original;
});

function command(name: string): Command {
  const found = listGroups()
    .flatMap((group) => group.commands)
    .find((entry) => entry.name === name);
  assert.ok(found?.kind === "command", `${name} is registered`);
  return found;
}

const rootHelp = () => stripVTControlCharacters(renderRoot(listGroups(), ""));

const FRAMEWORK = ["create", "dev", "build", "push", "promote", "publish", "pull"];

for (const channel of ["latest", "next"] as const) {
  test(`on the ${channel} channel, help lists the framework commands`, () => {
    process.env.SUPERWALL_CHANNEL = channel;
    const help = rootHelp();
    assert.match(help, /Paywalls & funnels/);
    for (const name of FRAMEWORK) {
      assert.match(help, new RegExp(`^  ${name}\\s`, "m"));
      command(name);
    }
  });

  test(`on the ${channel} channel, migrate rebuilds paywalls and screens`, () => {
    process.env.SUPERWALL_CHANNEL = channel;
    const migrate = command("migrate");
    assert.ok("paywall" in onChannel(migrate.args));
    assert.ok("screen" in onChannel(migrate.flags));
    assert.ok("screenshot" in onChannel(migrate.flags));
    assert.match(summaryOf(migrate), /rebuild a paywall or native screen as code/);
    const help = stripVTControlCharacters(renderCommand(migrate));
    assert.match(help, /--screen/);
    assert.match(help, /migrate 65920/);
  });
}
