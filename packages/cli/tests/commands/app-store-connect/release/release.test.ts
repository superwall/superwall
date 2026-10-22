import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as release } from "@/commands/app-store-connect/release/release";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { appVersion, BUILD_ID, VERSION_ID, VERSION_READ } from "../../../helpers/asc-store";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc release submit takes repeated --subscription, through the parser", async () => {
  const { api, writes } = ascRoutes({
    [VERSION_READ(["app", "build"])]: {
      data: appVersion({}, { app: link("apps", "555"), build: link("builds", BUILD_ID) }),
      included: [one("builds", BUILD_ID)],
    },
    "GET /v1/subscriptions/601/versions": page([one("subscriptionVersions", "SV1", { version: 1 })]),
    "GET /v1/subscriptions/602/versions": page([one("subscriptionVersions", "SV2", { version: 1 })]),
    "GET /v1/reviewSubmissions?filter[app]=555&filter[state]=READY_FOR_REVIEW&filter[platform]=IOS&limit=1": page([one("reviewSubmissions", "RS0")]),
  });
  const result = await runLine(`asc release submit ${VERSION_ID} --subscription 601 --subscription 602 --dry-run --json`, { api });
  assert.deepEqual(writes(), []);
  assert.equal((result.json as { requests: unknown[] }).requests.length, 8);
});

test("asc release phased takes its action as an argument, and the tools describe both", async () => {
  const help = await helpLine("asc release phased --help");
  assert.match(help, /start, pause, resume, complete/);
  const tools = await release.tools();
  const phased = tools.find((tool) => tool.words[0] === "phased");
  assert.deepEqual(phased?.positionals, ["action", "version"]);
  assert.deepEqual(phased?.input.properties.action?.enum, ["start", "pause", "resume", "complete"]);
  const submit = tools.find((tool) => tool.words[0] === "submit");
  assert.deepEqual(submit?.input.properties.subscription, { type: "array", items: { type: "string" }, description: "A subscription to submit with it (repeatable)" });
  assert.equal(tools.find((tool) => tool.words[0] === "release")?.effect, "destructive");
  assert.equal(tools.find((tool) => tool.words[0] === "status")?.effect, "read");
});
