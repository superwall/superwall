import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes } from "../../../helpers/asc-proxy";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc offers create needs its mode and duration", async () => {
  const { api, sent } = ascRoutes({});
  const result = await runLine("asc offers create --subscription 601 --duration ONE_WEEK", { api });
  assert.deepEqual(result.said("error"), ["asc offers create needs --offer-mode."]);
  assert.deepEqual(sent, []);
  assert.match(await helpLine("asc offers create --help"), /--offer-mode <mode> +required/);
});
