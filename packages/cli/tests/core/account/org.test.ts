import { test } from "node:test";
import assert from "node:assert/strict";
import { createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import { orgForNewProject } from "@/core/account/org";
import type { Session } from "@/core/auth/storage";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

// Hooks would leak into other files under Bun, so each test cleans up after itself.
const isolated = (body: () => Promise<void>) => async () => {
  useHome();
  try {
    await body();
  } finally {
    restoreFetch();
    clearHomes();
  }
};

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
