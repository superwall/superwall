import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { defineCatalog, defineCommand } from "@/program/command";
import { renderCommand, renderRoot, renderTopic } from "@/program/help";
import type { Group } from "@/commands/registry";

const original = process.env.SUPERWALL_CHANNEL;

afterEach(() => {
  process.env.SUPERWALL_CHANNEL = original;
});

const plain = (text: string) => stripVTControlCharacters(text);

const keysList = defineCommand({
  name: "asc keys list",
  summary: "Which keys the app has",
  flags: { app: { type: "string", value: "app", describe: "The app" } },
  examples: [["asc keys list --app <app>", "One app's keys"]],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "read",
  run: () => {},
});

const keysCreate = defineCommand({
  name: "asc keys create",
  summary: "Create a key at Apple",
  args: { kind: { describe: "api_key or purchase_key", required: true } },
  flags: {
    replace: { type: "boolean", describe: "Create another one" },
    secret: { type: "string", describe: "Never shown", hidden: true },
    screen: { type: "string", describe: "Next only", channel: "next" },
    role: { type: "string", choices: ["admin", "app_manager"], default: "app_manager", describe: "The role" },
  },
  details: "Signs in to Apple.",
  examples: [["asc keys create api_key --app <app>", "Create one"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  run: () => {},
});

const ascDocs = defineCommand({
  name: "asc docs",
  summary: "Apple's request schemas",
  examples: [["asc docs", "Browse"]],
  auth: "none",
  json: false,
  prompts: false,
  mcp: "read",
  run: () => {},
});

const apps = defineCatalog({
  name: "apps",
  summary: "Every app you can open",
  operations: () => ["list", "get", "update"],
  help: async () => "",
  tools: async () => [],
  examples: [["apps list", "Every app"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  run: () => {},
});

const asc: Group = {
  id: "app-store-connect",
  title: "App Store Connect",
  notes: ["Every asc command takes --team."],
  topics: [
    { name: "asc", summary: "App Store Connect through Superwall" },
    { name: "asc keys", summary: "An app's Apple keys", details: "Two keys per app." },
  ],
  commands: [ascDocs, keysList, keysCreate],
};

const setupApple = defineCommand({
  name: "setup apple",
  summary: "One Apple sign-in",
  examples: [["setup apple", "Set it up"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  run: () => {},
});

test("root help groups commands by section, folds a topic's commands into one row, and lists the flags", () => {
  const root = plain(
    renderRoot(
      [
        { id: "main", title: "Commands", commands: [apps] },
        { ...asc, topics: [...(asc.topics ?? []), { name: "setup", summary: "Set up" }], commands: [setupApple, ...asc.commands] },
      ],
      " · next channel",
    ),
  );
  assert.match(root, /next channel/);
  assert.match(root, /Commands\n {2}apps +Every app you can open +list · get · update/);
  assert.match(root, /App Store Connect\n {2}setup apple +One Apple sign-in\n {2}asc +App Store Connect through Superwall +docs · keys …/);
  assert.match(root, /Every asc command takes --team\./);
  assert.match(root, /--no-interactive +No prompts/);
});

test("a catalog's sibling commands fold into the catalog's row, after its operations", () => {
  const asa = { ...apps, name: "asa", summary: "Apple Search Ads" };
  const asaKeys = { ...ascDocs, name: "asa keys", summary: "Connected apps" };
  const root = plain(renderRoot([{ id: "apple-search-ads", title: "Apple Search Ads", commands: [asa, asaKeys] }], ""));
  assert.match(root, /^ {2}asa +Apple Search Ads +list · get · update · keys$/m);
  assert.doesNotMatch(root, /^ {2}asa keys/m);
});

test("a topic page lists what it holds, relative to itself, under its sections", () => {
  const page = plain(renderTopic({ name: "asc", summary: "App Store Connect through Superwall" }, asc));
  assert.match(page, /^superwall asc <command>/);
  assert.match(page, /^ {2}docs +Apple's request schemas$/m);
  assert.match(page, /^ {2}keys +An app's Apple keys +list · create$/m);
  const sectioned = plain(
    renderTopic(
      {
        name: "asc",
        summary: "App Store Connect through Superwall",
        sections: [
          { title: "Keys", commands: ["keys"] },
          { title: "Reference", commands: ["docs"] },
        ],
      },
      asc,
    ),
  );
  assert.match(sectioned, /Keys\n {2}keys +An app's Apple keys +list · create\n\nReference\n {2}docs +Apple's request schemas/);
  assert.doesNotMatch(sectioned, /Commands/);
  const keys = plain(renderTopic({ name: "asc keys", summary: "An app's Apple keys", details: "Two keys per app." }, asc));
  assert.match(keys, /^ {2}create +Create a key at Apple$/m);
  assert.match(keys, /Details\n {2}Two keys per app\./);
});

test("a command page is the same shape for every command: usage, arguments, flags, common, details, examples", () => {
  delete process.env.SUPERWALL_CHANNEL;
  const page = plain(renderCommand(keysCreate));
  assert.match(page, /^superwall asc keys create <kind> \[flags\]\nCreate a key at Apple/);
  assert.match(page, /Arguments\n {2}<kind> +api_key or purchase_key/);
  assert.match(page, /--replace +Create another one/);
  assert.match(page, /--role <admin\|app_manager> +The role \(default app_manager\)/);
  assert.doesNotMatch(page, /--secret|--screen/);
  assert.match(page, /Common\n {2}--json +Machine-readable output\n {2}--no-interactive/);
  assert.match(page, /Details\n {2}Signs in to Apple\./);
  assert.match(page, /Examples\n {2}\$ superwall asc keys create api_key --app <app> +Create one/);
  process.env.SUPERWALL_CHANNEL = "next";
  assert.match(plain(renderCommand(keysCreate)), /--screen <screen> +Next only/);
});

test("a command without --json or prompts doesn't offer them", () => {
  const page = plain(renderCommand(ascDocs));
  assert.doesNotMatch(page, /Common|--json|--no-interactive/);
  assert.match(page, /^superwall asc docs\n/);
});
