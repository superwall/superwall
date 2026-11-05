import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAppScope, resolveOrganization } from "@/core/workspaces/organization";
import { recordingRenderer } from "../../helpers/renderer";

const project = { id: 7, organization_id: 3, applications: [{ id: 42, name: "Pets" }] };

test("an app id with --org needs no lookup", async () => {
  const api = { get: async () => { throw new Error("no lookups"); } } as never;
  assert.deepEqual(await resolveAppScope(api, "42", "3"), { organizationId: "3", applicationId: "42" });
});

test("an app name finds its organization through its project", async () => {
  const api = { list: async () => [project] } as never;
  assert.deepEqual(await resolveAppScope(api, "Pets"), { organizationId: "3", applicationId: "42" });
  assert.deepEqual(await resolveAppScope(api, "Pets", "9"), { organizationId: "9", applicationId: "42" });
  await assert.rejects(resolveAppScope(api, "Nope"), /No app Nope/);
});

function context(organizations: unknown[], options: { interactive?: boolean; pick?: string | null } = {}) {
  const ui = recordingRenderer();
  ui.select = async () => options.pick ?? null;
  return { ui, interactive: options.interactive ?? false, outputMode: "text", api: { get: async () => ({ data: organizations }) } } as never;
}

test("--org wins, one organization is obvious, several are asked about", async () => {
  assert.equal(await resolveOrganization(context([]), "5"), "5");
  assert.equal(await resolveOrganization(context([{ id: 5 }]), undefined), "5");
  assert.equal(await resolveOrganization(context([{ id: 5, name: "A" }, { id: 6 }], { interactive: true, pick: "6" }), undefined), "6");
});

test("without a way to ask, it names the flag", async () => {
  await assert.rejects(resolveOrganization(context([{ id: 5 }, { id: 6 }]), undefined), /--org <id>/);
  await assert.rejects(resolveOrganization(context([], { interactive: true }), undefined), /--org <id>/);
  await assert.rejects(resolveOrganization(context([{ id: 5 }, { id: 6 }], { interactive: true, pick: null }), undefined), /No organization picked/);
});
