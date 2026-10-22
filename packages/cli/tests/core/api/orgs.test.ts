import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import {
  listOrganizations,
  listOrgGroups,
  listReachableProjects,
  organizationOf,
  orgIdOf,
  orgProjects,
  rememberOrg,
} from "@/core/api/orgs";
import { readOpenedOrgs, writeOpenedOrgs } from "@/core/state/config";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => clearHomes());

type Handlers = {
  list?: (path: string) => Promise<unknown[]>;
  get?: (path: string) => Promise<unknown>;
};

function fakeApi(handlers: Handlers) {
  const calls: string[] = [];
  const api = {
    list: async (path: string) => {
      calls.push(`LIST ${path}`);
      return handlers.list ? handlers.list(path) : [];
    },
    get: async (path: string) => {
      calls.push(`GET ${path}`);
      return handlers.get ? handlers.get(path) : {};
    },
  } as unknown as SuperwallApi;
  return { api, calls };
}

const failure = (status: number, body?: string) => new ApiError("GET /v2/projects", status, body);

test("listOrganizations keeps one entry per organization", async () => {
  const { api, calls } = fakeApi({
    get: async () => ({ data: [{ id: 1, name: "A" }, { id: "1", name: "A again" }, { id: 2, name: "B" }] }),
  });
  assert.deepEqual(await listOrganizations(api), [{ id: "1", name: "A again" }, { id: 2, name: "B" }]);
  assert.deepEqual(calls, ["GET /v2/me/organizations"]);
  assert.deepEqual(await listOrganizations(fakeApi({ get: async () => ({}) }).api), []);
});

test("orgProjects stamps each project with the organization it was listed under", async () => {
  const { api, calls } = fakeApi({ list: async () => [{ id: 1 }, { id: 2, organization_id: 9 }] });
  assert.deepEqual(await orgProjects(api, "a/b"), [
    { id: 1, organization_id: "a/b" },
    { id: 2, organization_id: 9 },
  ]);
  assert.deepEqual(calls, ["LIST /v2/projects?organization_id=a%2Fb"]);
});

test("orgIdOf reads a project's organization as text", () => {
  assert.equal(orgIdOf({ id: 1, organization_id: 7 }), "7");
  assert.equal(orgIdOf({ id: 1 }), undefined);
});

test("listReachableProjects lists the account's projects once each", async () => {
  useHome();
  const { api, calls } = fakeApi({
    list: async () => [{ id: 1, organization_id: 1 }, { id: 1, organization_id: 1 }, { id: 2 }],
  });
  assert.deepEqual(await listReachableProjects(api), [{ id: 1, organization_id: 1 }, { id: 2 }]);
  assert.deepEqual(calls, ["LIST /v2/projects"]);
});

test("listReachableProjects walks each organization when the API asks which one", async () => {
  useHome();
  const { api, calls } = fakeApi({
    list: async (path) => {
      if (path === "/v2/projects") throw failure(400, JSON.stringify({ message: "organization_id is required" }));
      return [{ id: path.endsWith("=1") ? 10 : 20 }];
    },
    get: async () => ({ data: [{ id: 1 }, { id: 2 }] }),
  });
  assert.deepEqual(await listReachableProjects(api), [
    { id: 10, organization_id: "1" },
    { id: 20, organization_id: "2" },
  ]);
  assert.deepEqual(calls, [
    "LIST /v2/projects",
    "GET /v2/me/organizations",
    "LIST /v2/projects?organization_id=1",
    "LIST /v2/projects?organization_id=2",
  ]);
});

test("listReachableProjects passes on any other failure", async () => {
  useHome();
  const other = failure(400, JSON.stringify({ message: "bad cursor" }));
  await assert.rejects(listReachableProjects(fakeApi({ list: async () => Promise.reject(other) }).api), (error) => error === other);
  const plain = new Error("offline");
  await assert.rejects(listReachableProjects(fakeApi({ list: async () => Promise.reject(plain) }).api), (error) => error === plain);
});

test("listReachableProjects adds opened organizations and forgets the ones it can no longer read", async () => {
  useHome();
  writeOpenedOrgs(["1", "5", "6", "7", "8"]);
  const { api } = fakeApi({
    list: async (path) => {
      if (path === "/v2/projects") return [{ id: 1, organization_id: 1 }];
      if (path.endsWith("=5")) return [{ id: 50 }];
      if (path.endsWith("=6")) throw failure(403);
      if (path.endsWith("=7")) throw failure(404);
      return [];
    },
  });
  assert.deepEqual(await listReachableProjects(api), [
    { id: 1, organization_id: 1 },
    { id: 50, organization_id: "5" },
  ]);
  assert.deepEqual(readOpenedOrgs(), ["5"]);
});

test("listReachableProjects fails when an opened organization fails for another reason", async () => {
  useHome();
  writeOpenedOrgs(["5"]);
  const broken = failure(500);
  const { api } = fakeApi({
    list: async (path) => {
      if (path === "/v2/projects") return [];
      throw broken;
    },
  });
  await assert.rejects(listReachableProjects(api), (error) => error === broken);
});

test("rememberOrg keeps an opened project's organization, and ignores projects without one", () => {
  useHome();
  rememberOrg(undefined);
  rememberOrg({ id: 1 });
  assert.deepEqual(readOpenedOrgs(), []);
  rememberOrg({ id: 2, organization_id: 9 });
  rememberOrg({ id: 3, organization_id: "4" });
  assert.deepEqual(readOpenedOrgs(), ["9", "4"]);
});

test("listOrgGroups groups projects by organization, members first, naming the others when it can", async () => {
  useHome();
  const { api, calls } = fakeApi({
    list: async () => [
      { id: 1, organization_id: 8 },
      { id: 2, organization_id: 1 },
      { id: 3, organization_id: 9 },
      { id: 4 },
      { id: 5, organization_id: 1 },
      { id: 6, organization_id: 10 },
    ],
    get: async (path) => {
      if (path === "/v2/me/organizations") return { data: [{ id: 1, name: "Mine" }, { id: 8, name: 42 }] };
      if (path === "/v2/organizations/9") return { name: "Theirs" };
      if (path === "/v2/organizations/10") throw failure(403);
      return {};
    },
  });
  const groups = await listOrgGroups(api);
  assert.deepEqual(
    groups.map((group) => [group.id, group.name, group.member, group.projects.map((project) => project.id)]),
    [
      ["8", undefined, true, [1]],
      ["1", "Mine", true, [2, 5]],
      ["", undefined, true, [4]],
      ["9", "Theirs", false, [3]],
      ["10", undefined, false, [6]],
    ],
  );
  assert.ok(!calls.includes("GET /v2/organizations/8"));
});

test("listOrgGroups still groups projects when memberships can't be read", async () => {
  useHome();
  const { api } = fakeApi({
    list: async () => [{ id: 1, organization_id: 3 }],
    get: async (path) => {
      if (path === "/v2/me/organizations") throw failure(500);
      return { name: "Three" };
    },
  });
  assert.deepEqual(await listOrgGroups(api), [{ id: "3", name: "Three", member: false, projects: [{ id: 1, organization_id: 3 }] }]);
});

test("organizationOf reads a known project's organization, or asks for the project", async () => {
  const { api, calls } = fakeApi({ get: async () => ({ id: 7, organization_id: 70 }) });
  assert.equal(await organizationOf(api, "1", [{ id: 1, organization_id: 10 }]), "10");
  assert.deepEqual(calls, []);
  assert.equal(await organizationOf(api, "7", [{ id: 7 }]), "70");
  assert.equal(await organizationOf(api, "a b"), "70");
  assert.deepEqual(calls, ["GET /v2/projects/7", "GET /v2/projects/a%20b"]);
  await assert.rejects(organizationOf(fakeApi({ get: async () => ({ id: 2 }) }).api, "2"), {
    message: "Couldn't tell which account project 2 belongs to.",
  });
});
