import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.SW_ASC_REFRESH = "1";

import { command as get } from "@/commands/app-store-connect/api/get";
import { command as del } from "@/commands/app-store-connect/api/delete";
import { command as patch } from "@/commands/app-store-connect/api/patch";
import { command as post } from "@/commands/app-store-connect/api/post";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { readCachedIndex, writeCachedIndex } from "@/core/app-store-connect/api/spec";
import { buildZip, serveZip } from "../../../helpers/asc-spec";
import { ascRoutes, fakeAscApi } from "../../../helpers/asc-proxy";
import { helpLine, runCommand, runLine } from "../../../helpers/command";
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
  assert.equal(errorOf(missing), "App Store Connect isn't connected. Run `superwall asc keys promote --app <app>` to use an app's saved key, or `superwall asc keys create --help`.");
  assert.equal(process.exitCode, 1);

  process.exitCode = undefined;
  const several = fakeAscApi({}, [{ team_id: "T1" }, { id: 9 }, {}]);
  const ambiguous = await runCommand(get, { api: several.api, args: { path: "/v1/apps" } });
  assert.equal(errorOf(ambiguous), "Multiple App Store Connect teams (T1, 9, ). Pass --team <id>.");
  assert.ok(!several.requests.some((request) => request.path.includes("/proxy/")));
});

const OVERVIEW = "GET /internal/v2/applications/20/integrations/overview";

test("with --app and no organization key, the error names the key saved on that app and the promote command", async () => {
  const saved = fakeAscApi(
    { [OVERVIEW]: { app_store_connect_configuration: { key_id: "RQB94UUB77", issuer_id: "I1", has_private_key: true }, in_app_purchase_configuration: null } },
    [],
  );
  const result = await runLine("asc get /v1/apps --app 20", { api: saved.api });
  assert.equal(
    errorOf(result),
    "App Store Connect isn't connected for this organization. The asc commands sign with the organization's key, not the one saved on an app: run `superwall asc keys promote --app 20` to give the organization the API key RQB94UUB77 saved on `20`.",
  );
  assert.ok(!saved.requests.some((request) => request.path.includes("/proxy/")));
});

test("with --app and a key saved on that app without its private key, the error asks for the .p8 before promoting", async () => {
  const partial = fakeAscApi(
    { [OVERVIEW]: { app_store_connect_configuration: { key_id: "RQB94UUB77", issuer_id: "I1", has_private_key: false }, in_app_purchase_configuration: null } },
    [],
  );
  const result = await runLine("asc get /v1/apps --app 20", { api: partial.api });
  assert.equal(
    errorOf(result),
    "App Store Connect isn't connected for this organization, and the API key RQB94UUB77 saved on `20` has no private key, so it can't sign. Save its .p8 with `superwall asc keys update api_key --app 20 --key-id RQB94UUB77 --issuer I1 --key-file <path.p8>`, then run `superwall asc keys promote --app 20`.",
  );
  assert.doesNotMatch(errorOf(result) ?? "", /to give the organization the API key/);
});

test("with --app and no key saved on that app either, the error says so and points to creating one", async () => {
  const none = fakeAscApi({ [OVERVIEW]: { app_store_connect_configuration: null, in_app_purchase_configuration: null } }, []);
  const result = await runLine("asc get /v1/apps --app 20", { api: none.api });
  assert.equal(errorOf(result), "App Store Connect isn't connected, and `20` has no API key saved. Run `superwall asc keys create api_key --app 20 --help`.");
});

test("a failed lookup of the app's saved key is reported, never read as no key", async () => {
  const { api } = fakeAscApi({}, []);
  const read = api.get;
  assert.ok(read);
  const failing: Partial<SuperwallApi> = {
    ...api,
    forOrg: (id: string) => ({ ...(failing as SuperwallApi), org: { id } }),
    get: async (path) => {
      if (path.endsWith("/integrations/overview")) throw new ApiError(`GET ${path}`, 500, "boom");
      return read(path);
    },
  };
  const result = await runLine("asc get /v1/apps --app 20", { api: failing });
  assert.doesNotMatch(errorOf(result) ?? "", /isn't connected/);
  assert.equal(process.exitCode, 1);
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

const proxied = (requests: { path: string }[]) => requests.filter((request) => request.path.includes("/proxy/"));

function seedInvitationSchema() {
  writeCachedIndex({
    specVersion: "4.5",
    openapi: "3.0.1",
    fetchedAt: Date.now(),
    paths: {
      "/v1/userInvitations": {
        post: {
          dataType: "userInvitations",
          attributes: { email: { required: true, type: "string" }, roles: { required: true, enum: ["ADMIN", "DEVELOPER"] } },
        },
      },
      "/v1/userInvitations/{id}": { patch: { dataType: "userInvitations", attributes: { roles: { required: false, enum: ["ADMIN", "DEVELOPER"] } } } },
    },
  });
}

test("asc post --dry-run prints the schema-built request and sends nothing", async () => {
  seedInvitationSchema();
  const { api, requests } = fakeAscApi();
  const result = await runLine("asc post /v1/userInvitations -d email=a@b.co -d roles=ADMIN --dry-run", { api });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(result.said("success"), ["Dry run: nothing was changed. 1 request:"]);
  assert.deepEqual(result.said("step"), ["POST /v1/userInvitations"]);
  assert.deepEqual(JSON.parse(result.said("report")[0] ?? ""), {
    data: { type: "userInvitations", attributes: { email: "a@b.co", roles: "ADMIN" } },
  });
  assert.deepEqual(proxied(requests), []);
});

test("asc patch --dry-run --json prints the plan in the resource commands' shape", async () => {
  seedInvitationSchema();
  const { api, requests } = fakeAscApi();
  const result = await runCommand(patch, { api, args: { path: "/v1/userInvitations/U1" }, flags: { d: ["roles=DEVELOPER"], dryRun: true }, json: true });
  assert.deepEqual(result.json, {
    dryRun: true,
    requests: [{ method: "PATCH", path: "/v1/userInvitations/U1", body: { data: { type: "userInvitations", id: "U1", attributes: { roles: "DEVELOPER" } } } }],
  });
  assert.deepEqual(proxied(requests), []);
});

test("a dry run still stops a body Apple's schema refuses, unless --force", async () => {
  seedInvitationSchema();
  const { api, requests } = fakeAscApi();
  const refused = await runCommand(post, { api, args: { path: "/v1/userInvitations" }, flags: { d: ["roles=OWNER"], dryRun: true } });
  assert.match(errorOf(refused) ?? "", /^Invalid POST \/v1\/userInvitations body:/);
  assert.equal(process.exitCode, 1);

  process.exitCode = undefined;
  const forced = await runCommand(post, { api, args: { path: "/v1/userInvitations" }, flags: { d: ["roles=OWNER"], dryRun: true, force: true }, json: true });
  assert.deepEqual(forced.json, {
    dryRun: true,
    requests: [{ method: "POST", path: "/v1/userInvitations", body: { data: { type: "userInvitations", attributes: { roles: "OWNER" } } } }],
  });
  assert.deepEqual(proxied(requests), []);
});

test("asc delete --dry-run names the request with no body and sends nothing", async () => {
  const { api, requests } = fakeAscApi();
  const result = await runCommand(del, { api, args: { path: "/v1/subscriptionGroups/G1" }, flags: { dryRun: true }, json: true });
  assert.deepEqual(result.json, { dryRun: true, requests: [{ method: "DELETE", path: "/v1/subscriptionGroups/G1" }] });
  assert.deepEqual(proxied(requests), []);
});

test("asc post, patch and delete list --dry-run in their help", async () => {
  for (const verb of ["post", "patch", "delete"]) assert.match(await helpLine(`asc ${verb} --help`), /--dry-run/);
});
