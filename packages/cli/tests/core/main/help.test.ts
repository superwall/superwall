import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { command as apps } from "@/commands/main/apps";
import { command as users } from "@/commands/main/users";
import type { DocOperation } from "@/core/api/reference";
import { defineResource } from "@/core/main/define";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

const plain = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, "");

const SPEC: DocOperation[] = [
  {
    method: "GET",
    path: "/v2/widgets",
    group: "Widgets",
    summary: "List widgets",
    description: "Lists every widget of an app.",
    params: [
      { name: "limit", in: "query", type: "number", required: false, description: "Page size" },
      { name: "starting_after", in: "query", type: "string", required: false },
      { name: "application_id", in: "query", type: "string", required: true },
      { name: "id", in: "path", type: "string", required: true },
    ],
    returns: [],
  },
  {
    method: "PATCH",
    path: "/v2/projects/{project_id}/widgets/{id}",
    group: "Widgets",
    summary: "Update a widget",
    params: [],
    body: [
      { name: "enabled", type: "boolean | null", required: false, description: "Whether it shows" },
      { name: "kind", type: "'alpha' | 'beta' | 'gamma' | 'delta'", required: false },
      { name: "name", type: "string", required: true, description: "Its name" },
      { name: "project_id", type: "string", required: true },
    ],
    returns: [],
  },
];

const widgets = defineResource({
  name: "widgets",
  summary: "Widgets of an app",
  operations: [
    { name: "list", summary: "Every widget", method: "GET", path: "/v2/widgets", list: true },
    { name: "update", summary: "Change one", method: "PATCH", path: "/v2/projects/{project_id}/widgets/{id}" },
    { name: "delete", summary: "Remove one", method: "DELETE", path: "/v2/widgets/{id}", destructive: true },
    {
      name: "make",
      summary: "Make one by hand",
      handler: "resource",
      usage: "--name <name>",
      flags: [["--name <name>", "What it is called"]],
      details: "Made locally, then sent.",
    },
  ],
  nested: [
    {
      name: "parts",
      summary: "Parts of a widget",
      operations: [{ name: "create", summary: "Add a part", method: "POST", path: "/v2/widgets/{id}/parts/{part_id}" }],
    },
  ],
  related: [["widgets list --app <app>", "Every widget of an app"]],
  examples: [["widgets update <widget> --name Big", "Rename one"]],
});

beforeEach(() => {
  const home = useHome();
  fs.writeFileSync(path.join(home, "api-index.json"), JSON.stringify({ version: "test", fetchedAt: Date.now(), operations: SPEC }));
});

afterEach(() => {
  restoreFetch();
  clearHomes();
});

test("a resource's page lists its operations with their arguments, its nested ones, related commands and examples", async () => {
  const page = plain(await widgets.help([]));
  assert.match(page, /^superwall widgets <operation> \[ids\] \[flags\]\nWidgets of an app\n/);
  assert.doesNotMatch(page, /Arguments/);
  assert.match(page, /Operations\n  list\s+Every widget\n  update <widget>\s+Change one\n  delete <widget>\s+Remove one\n  make --name <name>\s+Make one by hand/);
  assert.match(page, /widgets parts\n  create <widget> <part>\s+Add a part/);
  assert.match(page, /Related\n  superwall widgets list --app <app>\s+Every widget of an app/);
  assert.match(page, /Examples\n.*widgets update <widget> --name Big/);
  assert.match(page, /Run superwall widgets <operation> --help for an operation's flags\.\n$/);
  assert.equal(plain(await widgets.help(["nope"])), page);
});

test("an app resource's page takes the app as its argument", async () => {
  const page = plain(await apps.help([]));
  assert.match(page, /^superwall apps <operation> <app> \[flags\]/);
  assert.match(page, /Arguments\n  <app>\s+The app: an id, a name or a dashboard link/);
});

test("a nested resource's page lists only its operations", async () => {
  const page = plain(await widgets.help(["parts"]));
  assert.match(page, /^superwall widgets parts <operation>\nParts of a widget\n\nOperations\n  create <widget> <part>\s+Add a part\n\nRun superwall widgets parts <operation> --help/);
});

test("a list operation's flags are its query params, minus paging and scope, plus search and limit", async () => {
  const page = plain(await widgets.help(["list"]));
  assert.match(page, /^superwall widgets list \[flags\]\nEvery widget\n\nLists every widget of an app\./);
  assert.match(page, /Flags\n  --limit <number>\s+Page size\n/);
  assert.doesNotMatch(page, /--starting-after|--application-id|-d key=value|--dry-run/);
  assert.match(page, /Common\n  --app <app>.*\n  --search <text>.*\n  --limit <n>.*\n  --json/);
});

test("a write operation's flags are its body fields, typed, required ones marked", async () => {
  const page = plain(await widgets.help(["update"]));
  assert.match(page, /^superwall widgets update <widget> \[flags\]/);
  assert.match(page, /Arguments\n  <widget>\s+The widget's id/);
  assert.match(page, /  --enabled\s+Whether it shows/);
  assert.match(page, /  --kind <'alpha' \| 'beta' \| 'gam…>/);
  assert.match(page, /  --name <string>\s+required Its name/);
  assert.doesNotMatch(page, /--project-id/);
  assert.match(page, /Common\n  --app <app>.*\n  -d key=value.*\n  --dry-run\s+Print the request; send nothing\n  --json/);
});

test("an operation missing from the API reference says so, and a destructive one takes --yes", async () => {
  const page = plain(await widgets.help(["delete"]));
  assert.match(page, /Flags come from the API reference, which couldn't be loaded\./);
  assert.match(page, /Common\n  -d key=value.*\n  --dry-run.*\n  -y, --yes\s+Go ahead without asking\n  --json/);
  assert.doesNotMatch(page, /--app <app>/);
});

test("the reference not loading at all leaves the flags the operation declares", async () => {
  fs.rmSync(path.join(process.env.SUPERWALL_HOME!, "api-index.json"));
  useFetch([{ match: /./, fail: true }]);
  const page = plain(await widgets.help(["update"]));
  assert.match(page, /Flags come from the API reference, which couldn't be loaded\./);
  assert.doesNotMatch(page, /--enabled/);
});

test("a hand-written operation shows the flags and details it declares", async () => {
  const page = plain(await widgets.help(["make"]));
  assert.match(page, /^superwall widgets make --name <name> \[flags\]/);
  assert.match(page, /Flags\n  --name <name>\s+What it is called/);
  assert.match(page, /Common\n  --app <app>.*\n  --json/);
  assert.match(page, /Details\n.*Made locally, then sent\./);
});

test("a nested operation names each id it takes after what it belongs to", async () => {
  const page = plain(await widgets.help(["parts", "create"]));
  assert.match(page, /^superwall widgets parts create <widget> <part> \[flags\]/);
  assert.match(page, /Arguments\n  <widget>\s+The widget's id\n  <part>\s+The part's id/);
});

test("a user is found by their app user ID", async () => {
  const page = plain(await users.help(["get"]));
  assert.match(page, /Arguments\n  <user>\s+The user's app user ID/);
});

test("an app operation takes the app, not the ids the API path names", async () => {
  const page = plain(await apps.help(["statistics"]));
  assert.match(page, /Arguments\n  <app>\s+The app: an id, a name or a dashboard link/);
  assert.doesNotMatch(page, /--app <app>/);
});
