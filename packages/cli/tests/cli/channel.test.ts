import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Argv } from "yargs";
import { registerWorkflowCommands } from "@/cli/workflow";
import { printHelp } from "@/cli/help";

const original = process.env.SUPERWALL_CHANNEL;

afterEach(() => {
  process.env.SUPERWALL_CHANNEL = original;
});

function migrateShape(): { command: string; options: string[] } {
  let shape = { command: "", options: [] as string[] };
  const stub = new Proxy(
    {
      option: (name: string) => (shape.options.push(name), stub),
      options: (map: Record<string, unknown>) => (shape.options.push(...Object.keys(map)), stub),
      positional: (name: string) => (shape.options.push(name), stub),
    } as Record<string, unknown>,
    { get: (target, key) => (key in target ? target[key as string] : () => stub) },
  );
  const recorder = {
    command: (command: string, _describe: unknown, builder?: unknown) => {
      if (command.startsWith("migrate")) {
        shape = { command, options: [] };
        (builder as (y: unknown) => unknown)(stub);
      }
      return recorder;
    },
  } as unknown as Argv;
  registerWorkflowCommands(recorder);
  return shape;
}

function help(): string {
  let printed = "";
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    printed += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    printHelp();
  } finally {
    process.stdout.write = write;
  }
  return printed;
}

test("off the next channel, migrate is provider-only and the framework is absent from help", () => {
  delete process.env.SUPERWALL_CHANNEL;
  const shape = migrateShape();
  assert.equal(shape.command, "migrate");
  assert.ok(!shape.options.includes("paywall"));
  assert.ok(!shape.options.includes("screen"));
  const printed = help();
  assert.doesNotMatch(printed, /Paywalls & funnels|create \[dir\]|--screen|paywall-id|next channel/);
});

test("on the next channel, migrate rebuilds paywalls and screens and help lists the framework", () => {
  process.env.SUPERWALL_CHANNEL = "next";
  const shape = migrateShape();
  assert.equal(shape.command, "migrate [paywall]");
  assert.ok(shape.options.includes("paywall"));
  assert.ok(shape.options.includes("screen"));
  const printed = help();
  assert.match(printed, /Paywalls & funnels/);
  assert.match(printed, /create \[dir\]/);
  assert.match(printed, /next channel/);
});
