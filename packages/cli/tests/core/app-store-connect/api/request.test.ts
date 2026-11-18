import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.SW_ASC_REFRESH = "1";

import { command as get } from "@/commands/app-store-connect/api/get";
import { command as post } from "@/commands/app-store-connect/api/post";
import { ApiError } from "@/core/api/client";
import { readCachedIndex } from "@/core/app-store-connect/api/spec";
import { buildZip, serveZip } from "../../../helpers/asc-spec";
import { ascRoutes, fakeAscApi } from "../../../helpers/asc-proxy";
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

test("an answer with no content is ok, and an answer with a body passes through unchanged", async () => {
  const { api } = ascRoutes({
    "POST /v1/things": undefined,
    "GET /v1/apps": { data: [{ id: "555" }] },
  });
  const empty = await runCommand(post, { api, args: { path: "/v1/things" }, flags: { force: true }, json: true });
  assert.deepEqual(empty.json, { ok: true });
  const body = await runCommand(get, { api, args: { path: "/v1/apps" }, json: true });
  assert.deepEqual(body.json, { data: [{ id: "555" }] });
});

const LONG_REJECTION = JSON.stringify({
  errors: [
    {
      id: "4c1f0a4e-9d2b-4b8e-9a51-0f5b7c3d2e11",
      status: "409",
      code: "ENTITY_ERROR.ATTRIBUTE.INVALID",
      title: "An attribute value is invalid.",
      detail: "The provided entity includes an attribute with a value that is not valid for a pay-up-front promotional offer of this duration and number of periods.",
      source: { pointer: "/data/attributes/numberOfPeriods" },
    },
    {
      id: "b8e2",
      status: "409",
      code: "ENTITY_ERROR.RELATIONSHIP.INVALID",
      title: "A relationship value is invalid.",
      source: { pointer: "/data/relationships/prices" },
    },
  ],
});

test("Apple's validation errors come out whole, with code and pointer, past the first 200 characters", async () => {
  assert.ok(LONG_REJECTION.indexOf("/data/attributes/numberOfPeriods") > 200);
  const { api } = ascRoutes({
    "POST /v1/subscriptionPromotionalOffers": new ApiError(
      "POST /v2/organizations/7/app-store-connect/proxy/T1/v1/subscriptionPromotionalOffers",
      409,
      LONG_REJECTION,
    ),
  });
  const result = await runCommand(post, { api, args: { path: "/v1/subscriptionPromotionalOffers" }, flags: { force: true } });
  assert.equal(
    errorOf(result),
    [
      "App Store Connect refused POST /v1/subscriptionPromotionalOffers (409):",
      "  • ENTITY_ERROR.ATTRIBUTE.INVALID: The provided entity includes an attribute with a value that is not valid for a pay-up-front promotional offer of this duration and number of periods. (/data/attributes/numberOfPeriods)",
      "  • ENTITY_ERROR.RELATIONSHIP.INVALID: A relationship value is invalid. (/data/relationships/prices)",
    ].join("\n"),
  );
  assert.equal(process.exitCode, 1);
});

test("in JSON output an Apple refusal keeps its HTTP status", async () => {
  const { api } = ascRoutes({
    "GET /v1/apps?filter[nope]=1": new ApiError(
      "GET /v2/organizations/7/app-store-connect/proxy/T1/v1/apps?filter[nope]=1",
      400,
      JSON.stringify({ errors: [{ code: "PARAMETER_ERROR.INVALID", title: "A parameter has an invalid value", source: { parameter: "filter[nope]" } }] }),
    ),
  });
  const result = await runCommand(get, { api, args: { path: "/v1/apps?filter[nope]=1" }, json: true });
  assert.deepEqual(result.json, {
    error: {
      code: "api_error",
      status: 400,
      message: "App Store Connect refused GET /v1/apps?filter[nope]=1 (400):\n  • PARAMETER_ERROR.INVALID: A parameter has an invalid value (filter[nope])",
    },
  });
});

test("a body that isn't an Apple error document still shows the HTTP snippet", async () => {
  const { api } = ascRoutes({
    "GET /v1/apps": new ApiError("GET /v2/organizations/7/app-store-connect/proxy/T1/v1/apps", 502, "<html>Bad gateway</html>"),
  });
  const result = await runCommand(get, { api, args: { path: "/v1/apps" }, json: true });
  assert.deepEqual(result.json, { error: { code: "api_error", status: 502, message: "HTTP 502 — <html>Bad gateway</html>" } });
});
