import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import type { Argv } from "yargs";
import { registerAccountCommands } from "@/cli/account";
import { registerPaywallCommands } from "@/cli/paywalls";
import { registerPlatformCommands } from "@/cli/platform";
import { registerResourceCommands } from "@/cli/resources";
import { registerWorkflowCommands } from "@/cli/workflow";

type Option = { name: string; describe?: string; type?: string };

type Registered = {
  command: string;
  describe: string;
  handler: (argv: never) => unknown;
  options: Option[];
};

const registrars = [
  registerWorkflowCommands,
  registerAccountCommands,
  registerPlatformCommands,
  registerResourceCommands,
  registerPaywallCommands,
];

function build(builder: unknown): Option[] {
  if (typeof builder !== "function") return [];
  const options: Option[] = [];
  const record = (name: string, config: unknown) => {
    const shape = (config ?? {}) as { describe?: string; type?: string };
    options.push({ name, describe: shape.describe, type: shape.type });
  };
  const stub = new Proxy(
    {
      option: (name: string, config: unknown) => (record(name, config), stub),
      options: (map: Record<string, unknown>) => {
        for (const [name, config] of Object.entries(map)) record(name, config);
        return stub;
      },
      positional: (name: string, config: unknown) => (record(name, config), stub),
    } as Record<string, unknown>,
    {
      get: (target, key) =>
        key in target ? target[key as string] : () => stub,
    },
  );
  (builder as (argv: unknown) => unknown)(stub);
  return options;
}

function table(): Registered[] {
  const found: Registered[] = [];
  const recorder = {
    command: (
      command: string,
      describe: string | false,
      builder?: unknown,
      handler?: (argv: never) => unknown,
    ) => {
      if (describe !== false && handler) {
        found.push({ command, describe, handler, options: build(builder) });
      }
      return recorder;
    },
  } as unknown as Argv;

  for (const register of registrars) register(recorder);
  return found;
}

test("every command registers with a description and a handler", () => {
  const commands = table();

  assert.ok(commands.length >= 19, `only ${commands.length} commands registered`);
  for (const { command, describe, handler } of commands) {
    assert.equal(typeof handler, "function", `${command} has no handler`);
    assert.notEqual(describe.trim(), "", `${command} has no description`);
  }
});

test("every flag and positional a command takes says what it is for", () => {
  const undescribed = table().flatMap(({ command, options }) =>
    options
      .filter((option) => (option.describe ?? "").trim() === "")
      .map((option) => `${command} → ${option.name}`),
  );

  assert.deepEqual(undescribed, []);
});

test("the hand-written help screen names every registered command", async () => {
  const { printHelp } = await import("@/cli/help");
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

  const missing = table()
    .map(({ command }) => command.split(/[ <[]/)[0] ?? "")
    .filter((name) => name !== "" && !printed.includes(name));

  assert.deepEqual(missing, [], `not in printHelp(): ${missing.join(", ")}`);
});

test("every lazily imported handler module exists and exports what it is called for", async () => {
  const dir = path.join(import.meta.dirname, "..", "..", "src", "cli");
  const lazy = new Map<string, Set<string>>();

  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/import\("([^"]+)"\)\.then\(\(m\) => m\.(\w+)/g)) {
      const specifier = match[1];
      const name = match[2];
      if (specifier === undefined || name === undefined) continue;
      const named = lazy.get(specifier) ?? new Set<string>();
      named.add(name);
      lazy.set(specifier, named);
    }
  }

  assert.ok(lazy.size >= 15, `found only ${lazy.size} lazy imports`);

  for (const [specifier, names] of lazy) {
    const loaded = (await import(specifier.replace("@/", "../../src/"))) as Record<string, unknown>;
    for (const name of names) {
      assert.equal(typeof loaded[name], "function", `${specifier} does not export ${name}()`);
    }
  }
});
