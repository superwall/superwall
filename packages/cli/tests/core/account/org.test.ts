import { test } from "node:test";
import assert from "node:assert/strict";
import { createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import { chooseOrgOfApps, orgForNewProject } from "@/core/account/org";
import type { Session } from "@/core/account/storage";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { recordingRenderer } from "../../helpers/renderer";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import type { SelectOpts } from "@/ui/types";

const isolated = (body: () => Promise<void>) => async () => {
  useHome();
  try {
    await body();
  } finally {
    restoreFetch();
    clearHomes();
    selectRenderer({ mode: "text" });
  }
};

function picking(answer: string | null): SelectOpts[] {
  const asked: SelectOpts[] = [];
  useRenderer({ ...recordingRenderer(), select: async (value) => (asked.push(value), answer) });
  return asked;
}

function apiWithOrgs(
  orgs: Array<{ id: number; name: string }> | null,
  session: Partial<Session> = {},
): SuperwallApi {
  useFetch([{ match: "/v2/me/organizations", body: { data: orgs } }]);
  return createSuperwallApi({
    apiKey: "sk_x",
    host: "https://api.example.com",
    createdAt: "n",
    ...session,
  });
}

test(
  "a new project goes to the only organization without asking",
  isolated(async () => {
    const api = apiWithOrgs([{ id: 7, name: "Solo Inc" }]);
    assert.equal(await orgForNewProject(api, false), "7");
  }),
);

test(
  "with several organizations and no prompt, a new project is refused with what to do",
  isolated(async () => {
    const api = apiWithOrgs([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);
    await assert.rejects(
      () => orgForNewProject(api, false),
      /belong to 2 organizations[\s\S]*run this interactively[\s\S]*--project <id>/,
    );
  }),
);

test(
  "an account with no organization is sent to login",
  isolated(async () => {
    const api = apiWithOrgs([]);
    await assert.rejects(() => orgForNewProject(api, false), /superwall login/);
  }),
);

test(
  "with several organizations and someone to ask, the chosen one owns the new project",
  isolated(async () => {
    const asked = picking("2");
    const api = createSuperwallApi({ apiKey: "sk_x", host: "https://api.example.com", createdAt: "n" });
    useFetch([
      {
        match: "/v2/me/organizations",
        body: { data: [{ id: 1, name: "A", role: "ADMIN" }, { id: 2, name: "B" }] },
      },
    ]);

    assert.equal(await orgForNewProject(api, true), "2");
    assert.deepEqual(asked, [
      {
        message: "Which organization should own the new project?",
        options: [
          { value: "1", label: "A", hint: "Admin" },
          { value: "2", label: "B", hint: "" },
        ],
      },
    ]);
  }),
);

test(
  "escaping the organization choice cancels",
  isolated(async () => {
    picking(null);
    const api = apiWithOrgs([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);

    await assert.rejects(() => orgForNewProject(api, true), /^Error: Cancelled\.$/);
  }),
);

test(
  "choosing whose apps lists member organizations first and names the others",
  isolated(async () => {
    const asked = picking("9");
    const api = createSuperwallApi({ apiKey: "sk_x", host: "https://api.example.com", createdAt: "n" });
    useFetch([
      {
        match: "/v2/projects",
        body: {
          data: [
            { id: 1, organization_id: 9 },
            { id: 2, organization_id: 7 },
            { id: 3, organization_id: 11 },
          ],
        },
      },
      { match: "/v2/me/organizations", body: { data: [{ id: 7, name: "Acme" }] } },
      { match: "/v2/organizations/9", body: { id: 9, name: "Partner" } },
      { match: "/v2/organizations/11", status: 403 },
    ]);

    assert.equal(await chooseOrgOfApps(api, "Whose apps?"), "9");
    assert.deepEqual(asked, [
      {
        message: "Whose apps?",
        options: [
          { value: "7", label: "Acme", hint: "" },
          { value: "9", label: "Partner", hint: "Not a member" },
          { value: "11", label: "Organization 11", hint: "Not a member" },
        ],
      },
    ]);
  }),
);
