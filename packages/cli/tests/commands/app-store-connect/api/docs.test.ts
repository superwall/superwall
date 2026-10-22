import assert from "node:assert/strict";
import { test } from "node:test";
import { command as docs } from "@/commands/app-store-connect/api/docs";
import { runCommand } from "../../../helpers/command";
import { useAscIndex } from "../../../helpers/asc-spec";

useAscIndex();

process.env.SW_ASC_REFRESH = "1";

const markdown = (result: { json: unknown }) => (result.json as { markdown: string }).markdown;

test("a path and a verb show that endpoint's schema", async () => {
  const result = await runCommand(docs, { api: {}, args: { query: ["/v1/subscriptionGroups", "post"] }, json: true });
  assert.match(markdown(result), /### POST \/v1\/subscriptionGroups/);
  assert.doesNotMatch(markdown(result), /### GET /);
});

test("words search every endpoint, and nothing lists the resources", async () => {
  const search = await runCommand(docs, { api: {}, args: { query: ["subscription", "groups"] }, json: true });
  assert.match(markdown(search), /\/v1\/subscriptionGroups/);
  const roots = await runCommand(docs, { api: {}, json: true });
  assert.match(markdown(roots), /top-level resources/);
});
