import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as builds } from "@/commands/app-store-connect/release/builds";
import { ascRoutes } from "../../../helpers/asc-proxy";
import { VERSION_ID } from "../../../helpers/asc-store";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc builds attach takes the build then the version, through the parser", async () => {
  const { api, writes } = ascRoutes({ [`PATCH /v1/appStoreVersions/${VERSION_ID}/relationships/build`]: undefined });
  await runLine(`asc builds attach B1 ${VERSION_ID}`, { api });
  assert.deepEqual(writes(), [{ method: "PATCH", path: `/v1/appStoreVersions/${VERSION_ID}/relationships/build`, body: { data: { type: "builds", id: "B1" } } }]);
});

test("asc builds help shows the filters, and the tools their positionals", async () => {
  const list = await helpLine("asc builds list --help");
  assert.match(list, /--processing-state <state>/);
  assert.match(list, /PROCESSING, FAILED, INVALID/);
  const tools = await builds.tools();
  assert.deepEqual(tools.find((tool) => tool.words[0] === "attach")?.positionals, ["id", "version"]);
  assert.equal(tools.find((tool) => tool.words[0] === "expire")?.effect, "destructive");
});
