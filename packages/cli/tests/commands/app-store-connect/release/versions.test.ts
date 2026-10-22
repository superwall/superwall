import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as versions } from "@/commands/app-store-connect/release/versions";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { VERSION_FIELDS } from "../../../helpers/asc-store";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc versions list takes the app and Apple's state filter, through the parser", async () => {
  const { api } = ascRoutes({
    [`GET /v1/apps/555/appStoreVersions?filter[appVersionState]=PENDING_DEVELOPER_RELEASE&fields[appStoreVersions]=${VERSION_FIELDS}&limit=200`]: page([
      one("appStoreVersions", "V1", { versionString: "1.2.0" }),
    ]),
  });
  const result = await runLine("asc versions list 555 --app-version-state pending-developer-release --json", { api });
  assert.deepEqual(result.json, [{ id: "V1", versionString: "1.2.0" }]);
});

test("asc versions help lists the operations, the platforms and the release types", async () => {
  assert.match(await helpLine("asc versions --help"), /delete/);
  const create = await helpLine("asc versions create --help");
  assert.match(create, /--version-string <1\.2\.0>/);
  assert.match(create, /MANUAL, AFTER_APPROVAL/);
  const tools = await versions.tools();
  assert.deepEqual(tools.find((tool) => tool.words[0] === "create")?.input.required, ["asc_app", "version_string"]);
  assert.equal(tools.find((tool) => tool.words[0] === "delete")?.effect, "destructive");
});
