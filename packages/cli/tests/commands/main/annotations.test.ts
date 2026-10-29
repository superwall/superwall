import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

const ANNOTATIONS = "/v2/applications/5861/chart_annotations";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("GET", "/v2/applications/{application_id}/chart_annotations", {
      params: [
        { name: "from", type: "string", required: false, in: "query" },
        { name: "to", type: "string", required: false, in: "query" },
      ],
    }),
    op("POST", "/v2/applications/{application_id}/chart_annotations", {
      body: [
        { name: "label", type: "string", required: true, description: "What happened" },
        { name: "description", type: "string | null", required: false },
        { name: "start_at", type: "string", required: true },
        { name: "end_at", type: "string | null", required: false },
      ],
    }),
    op("PATCH", "/v2/applications/{application_id}/chart_annotations/{chart_annotation_id}", {
      body: [
        { name: "label", type: "string", required: false },
        { name: "description", type: "string | null", required: false },
        { name: "start_at", type: "string", required: false },
        { name: "end_at", type: "string | null", required: false },
      ],
    }),
    op("DELETE", "/v2/applications/{application_id}/chart_annotations/{chart_annotation_id}"),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("creating an annotation fills its application from --app", async () => {
  const calls: ApiCall[] = [];
  const created = { object: "chart_annotation", id: "9", label: "v4.2.0" };
  const api = fakeResourceApi(calls, { [`POST ${ANNOTATIONS}`]: created });

  const result = await runLine(
    "annotations create --app 5861 --label v4.2.0 --start-at 2026-10-28T14:00:00Z --json",
    { api },
  );

  assert.deepEqual(calls, [
    {
      method: "POST",
      path: ANNOTATIONS,
      body: { label: "v4.2.0", start_at: "2026-10-28T14:00:00Z" },
    },
  ]);
  assert.deepEqual(result.json, created);
});

test("null clears a nullable field, so a span becomes a point", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { [`PATCH ${ANNOTATIONS}/9`]: { id: "9", end_at: null } });

  await runLine("annotations update 9 --app 5861 --end-at null --description null --json", { api });

  assert.deepEqual(calls, [
    { method: "PATCH", path: `${ANNOTATIONS}/9`, body: { end_at: null, description: null } },
  ]);
});

test("a label that reads null stays a string, since the field isn't nullable", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { [`PATCH ${ANNOTATIONS}/9`]: { id: "9" } });

  await runLine("annotations update 9 --app 5861 --label null --json", { api });

  assert.deepEqual(calls, [{ method: "PATCH", path: `${ANNOTATIONS}/9`, body: { label: "null" } }]);
});

test("listing sends the window as query parameters", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, {
    [`GET ${ANNOTATIONS}?from=2026-10-01T00%3A00%3A00Z&to=2026-10-31T00%3A00%3A00Z`]: {
      object: "list",
      data: [],
      can_write: true,
    },
  });

  await runLine(
    "annotations list --app 5861 --from 2026-10-01T00:00:00Z --to 2026-10-31T00:00:00Z --json",
    {
      api,
    },
  );

  assert.deepEqual(calls, [
    {
      method: "GET",
      path: `${ANNOTATIONS}?from=2026-10-01T00%3A00%3A00Z&to=2026-10-31T00%3A00%3A00Z`,
    },
  ]);
});

test("deleting is destructive: refused without --yes, sent with it", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, {
    [`DELETE ${ANNOTATIONS}/9`]: { object: "chart_annotation", id: "9", deleted: true },
  });

  const refused = await runLine("annotations delete 9 --app 5861 --json", { api });
  assert.match(
    (refused.json as { error: { message: string } }).error.message,
    /Delete an annotation/,
  );
  assert.deepEqual(calls, []);

  const deleted = await runLine("annotations delete 9 --app 5861 --yes --json", { api });
  assert.deepEqual(calls, [{ method: "DELETE", path: `${ANNOTATIONS}/9` }]);
  assert.deepEqual(deleted.json, { object: "chart_annotation", id: "9", deleted: true });
});
