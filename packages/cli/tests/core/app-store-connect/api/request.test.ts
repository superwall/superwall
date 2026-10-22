import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.SW_ASC_REFRESH = "1";

import { command as get } from "@/commands/app-store-connect/api/get";
import { command as post } from "@/commands/app-store-connect/api/post";
import { readCachedIndex } from "@/core/app-store-connect/api/spec";
import { buildZip, serveZip } from "../../../helpers/asc-spec";
import { fakeAscApi } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";
import { restoreFetch } from "../../../helpers/fetch";

afterEach(() => {
  restoreFetch();
  process.exitCode = undefined;
});


const SPEC = {
  openapi: "3.0.1",
  info: { version: "4.5" },
  paths: {
    "/v1/things": {
      post: {
        operationId: "things_create",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  data: {
                    properties: {
                      type: { enum: ["things"] },
                      attributes: { properties: { name: { type: "string" } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const errorOf = (result: { said(method: string): string[] }) => result.said("error")[0];

test("a write with no cached schema downloads Apple's schema first, then builds the body from it", async () => {
  const urls = serveZip(buildZip([{ name: "openapi.json", data: Buffer.from(JSON.stringify(SPEC)), deflate: true }]));
  const { api, requests } = fakeAscApi();
  await runCommand(post, { api, args: { path: "/v1/things" }, flags: { d: ["name=Widget"] }, json: true });
  assert.equal(urls.length, 1);
  assert.equal(readCachedIndex().specVersion, "4.5");
  assert.deepEqual(requests.at(-1), {
    method: "POST",
    path: "/v2/organizations/7/app-store-connect/proxy/T1/v1/things",
    body: { data: { type: "things", attributes: { name: "Widget" } } },
  });
});

test("a write to a path the schema doesn't know is sent as given", async () => {
  const { api, requests } = fakeAscApi();
  await runCommand(post, { api, args: { path: "/v1/unknown" }, flags: { d: ["a=1", "b:=2"] }, json: true });
  assert.deepEqual(requests.at(-1)?.body, { a: "1", b: 2 });
});

test("--team picks the team without listing the organization's keys", async () => {
  const { api, requests } = fakeAscApi({}, []);
  await runCommand(get, { api, args: { path: "/v1/apps" }, flags: { team: "T9" }, json: true });
  assert.deepEqual(
    requests.map((request) => request.path),
    ["/v2/organizations/7/app-store-connect/proxy/T9/v1/apps"],
  );
});

test("a team without a team_id is addressed by its id", async () => {
  const { api, requests } = fakeAscApi({}, [{ id: 42 }]);
  await runCommand(get, { api, args: { path: "/v1/apps" }, json: true });
  assert.equal(requests.at(-1)?.path, "/v2/organizations/7/app-store-connect/proxy/42/v1/apps");
});

test("no App Store Connect key, or several, stops before Apple is called", async () => {
  const none = fakeAscApi({}, []);
  const missing = await runCommand(get, { api: none.api, args: { path: "/v1/apps" } });
  assert.equal(errorOf(missing), "App Store Connect isn't connected. Run `superwall asc keys create --help`.");
  assert.equal(process.exitCode, 1);

  process.exitCode = undefined;
  const several = fakeAscApi({}, [{ team_id: "T1" }, { id: 9 }, {}]);
  const ambiguous = await runCommand(get, { api: several.api, args: { path: "/v1/apps" } });
  assert.equal(errorOf(ambiguous), "Multiple App Store Connect teams (T1, 9, ). Pass --team <id>.");
  assert.ok(!several.requests.some((request) => request.path.includes("/proxy/")));
});
