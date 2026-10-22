import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes } from "../../../helpers/asc-proxy";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc screenshots upload needs the file", async () => {
  const { api } = ascRoutes({});
  const result = await runLine("asc screenshots upload --subscription 601", { api });
  assert.deepEqual(result.said("error"), ["asc screenshots upload needs <file>."]);
  assert.match(await helpLine("asc screenshots upload --help"), /<file>/);
});
