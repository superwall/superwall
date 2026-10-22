import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { defineCatalog, defineCommand, UsageError } from "@/program/command";
import { resolveLine } from "@/program/parse";
import type { Group } from "@/commands/registry";

const original = process.env.SUPERWALL_CHANNEL;

afterEach(() => {
  process.env.SUPERWALL_CHANNEL = original;
});

const keysCreate = defineCommand({
  name: "asc keys create",
  summary: "Create a key",
  args: { kind: { describe: "The kind", choices: ["api_key", "purchase_key"] } },
  flags: {
    keyFile: { type: "string", describe: "A key file" },
    yes: { type: "boolean", alias: "y", describe: "Go ahead" },
    d: { type: "list", describe: "A field" },
    limit: { type: "number", describe: "At most" },
    screen: { type: "string", describe: "A screen", channel: "next" },
  },
  examples: [["asc keys create api_key", "Create one"]],
  auth: "none",
  json: true,
  prompts: true,
  mcp: "read",
  run: () => {},
});

const ascDocs = defineCommand({
  name: "asc docs",
  summary: "Docs",
  args: { query: { describe: "Words", variadic: true } },
  examples: [["asc docs", "Browse"]],
  auth: "none",
  json: true,
  prompts: false,
  mcp: "read",
  run: () => {},
});

const apps = defineCatalog({
  name: "apps",
  summary: "Apps",
  flags: { yes: { type: "boolean", alias: "y", describe: "Go ahead" } },
  operations: () => ["list", "get"],
  help: async () => "apps help",
  tools: async () => [],
  examples: [["apps list", "Every app"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  run: () => {},
});

const groups: Group[] = [
  {
    id: "app-store-connect",
    title: "App Store Connect",
    topics: [
      { name: "asc", summary: "App Store Connect" },
      { name: "asc keys", summary: "Keys" },
    ],
    commands: [keysCreate, ascDocs],
  },
  { id: "account", title: "Your account", commands: [apps] },
];

test("the longest matching command wins, and its arguments and flags are typed by the spec", () => {
  const resolution = resolveLine(
    ["asc", "keys", "create", "api_key", "--key-file", "a.p8", "-y", "-d", "a=1", "-d", "b=2", "--limit", "007", "--json"],
    groups,
  );
  assert.equal(resolution.kind, "run");
  if (resolution.kind !== "run") return;
  assert.equal(resolution.command, keysCreate);
  assert.deepEqual(resolution.input.args, { kind: "api_key" });
  assert.equal(resolution.input.flags?.keyFile, "a.p8");
  assert.equal(resolution.input.flags?.yes, true);
  assert.deepEqual(resolution.input.flags?.d, ["a=1", "b=2"]);
  assert.equal(resolution.input.flags?.limit, "007");
  assert.equal(resolution.input.json, true);
});

test("a variadic argument takes the rest of the words", () => {
  const resolution = resolveLine(["asc", "docs", "introductory", "offer"], groups);
  assert.equal(resolution.kind === "run" && resolution.input.args?.query instanceof Array, true);
  if (resolution.kind === "run") assert.deepEqual(resolution.input.args?.query, ["introductory", "offer"]);
});

test("usage mistakes are refused before anything runs, naming the command", () => {
  const refused = (tokens: string[], message: RegExp) => {
    assert.throws(
      () => resolveLine(tokens, groups),
      (error: unknown) => error instanceof UsageError && message.test(error.message) && error.command === "asc keys create",
    );
  };
  refused(["asc", "keys", "create", "--bogus"], /Unknown flag: --bogus/);
  refused(["asc", "keys", "create", "api_key", "extra"], /doesn't take "extra"/);
  refused(["asc", "keys", "create", "nope"], /<kind> is one of: api_key, purchase_key/);
  refused(["asc", "keys", "create", "--limit", "many"], /--limit takes a number/);
});

test("a flag of another channel doesn't exist off that channel", () => {
  delete process.env.SUPERWALL_CHANNEL;
  assert.throws(() => resolveLine(["asc", "keys", "create", "--screen", "x"], groups), /Unknown flag: --screen/);
  process.env.SUPERWALL_CHANNEL = "next";
  const resolution = resolveLine(["asc", "keys", "create", "--screen", "x"], groups);
  assert.equal(resolution.kind === "run" && resolution.input.flags?.screen, "x");
});

test("a topic alone, or with --help, explains itself; an unknown word under it says what it takes", () => {
  assert.equal(resolveLine(["asc", "keys"], groups).kind, "topic");
  assert.equal(resolveLine(["asc", "--help"], groups).kind, "topic");
  assert.throws(() => resolveLine(["asc", "keys", "rotate"], groups), /`superwall asc keys` has no "rotate". It takes: create/);
});

test("--help on a command asks for its page, and a catalog gets its words", () => {
  const help = resolveLine(["asc", "keys", "create", "--help", "--bogus"], groups);
  assert.equal(help.kind, "help");
  const catalog = resolveLine(["apps", "get", "--help"], groups);
  assert.equal(catalog.kind === "help" && catalog.words.join(" "), "get");
});

test("a catalog takes any flag and passes its words through", () => {
  const resolution = resolveLine(["apps", "update", "5861", "--event-name", "x", "-y"], groups);
  assert.equal(resolution.kind, "run");
  if (resolution.kind !== "run") return;
  assert.deepEqual(resolution.input.words, ["update", "5861"]);
  assert.equal(resolution.input.flags?.eventName, "x");
  assert.equal(resolution.input.flags?.yes, true);
});

test("words that match nothing are left for the caller to report", () => {
  assert.equal(resolveLine(["nothing", "here"], groups).kind, "none");
  assert.equal(resolveLine(["--json", "--no-interactive"], groups).kind, "none");
});
