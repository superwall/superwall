import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { afterEach, test } from "node:test";
import { platformForIntegration, resolveAppBinding, resolveScopeFromKey } from "@/core/account/bind";
import type { SuperwallApi } from "@/core/api/client";
import type { Application, Project } from "@/core/api/resources";
import { Integration } from "@/environment";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { readState, reset } from "@/ui/ink/store";
import type { SelectOpts, TextOpts } from "@/ui/types";
import { clearHomes, useHome } from "../../helpers/home";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

afterEach(() => {
  clearHomes();
  selectRenderer({ mode: "text" });
});

test("an empty project offers app creation with the detected name prefilled", async () => {
  reset();
  selectRenderer({ mode: "rich" });
  const api = {
    list: async () => [{ id: "project_1", name: "Monoroll", applications: [] }],
  } as unknown as SuperwallApi;

  const result = resolveAppBinding(api, {
    platform: "ios",
    appName: "Monoroll",
    bundleId: "com.example.monoroll",
  });
  await waitForImmediate();

  let active = readState().active;
  assert.equal(active?.type, "select");
  if (active?.type !== "select") return;
  assert.equal(active.message, "Which Superwall project?");
  active.resolve("project_1");
  await waitForImmediate();

  active = readState().active;
  assert.equal(active?.type, "select");
  if (active?.type !== "select") return;
  assert.equal(active.message, "No apps in `Monoroll` yet.");
  assert.deepEqual(active.options, [
    {
      value: "__new__",
      label: "＋ Create a new iOS app",
      hint: "Monoroll",
    },
  ]);
  active.resolve("__new__");
  await waitForImmediate();

  active = readState().active;
  assert.equal(active?.type, "text");
  if (active?.type !== "text") return;
  assert.equal(active.value, "Monoroll");
  active.resolve(null);
  await waitForImmediate();

  active = readState().active;
  if (active?.type !== "select") return;
  active.resolve(null);
  await waitForImmediate();

  active = readState().active;
  if (active?.type !== "select") return;
  active.resolve(null);
  assert.equal(await result, null);
  reset();
  selectRenderer({ mode: "text" });
});

type Posted = { path: string; body: unknown };

function fakeApi(
  projects: Project[],
  created: { project?: unknown; applications?: Application[][] } = {},
): { api: SuperwallApi; posted: Posted[]; listed: () => number } {
  const posted: Posted[] = [];
  const applications = [...(created.applications ?? [])];
  let lists = 0;
  const api = {
    list: async () => (lists++, projects),
    get: async (path: string) => {
      assert.equal(path, "/v2/me/organizations");
      return { data: [{ id: 7, name: "Acme" }] };
    },
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      if (path.endsWith("/applications")) return { id: 5, applications: applications.shift() ?? [] };
      return created.project;
    },
  };
  return { api: api as unknown as SuperwallApi, posted, listed: () => lists };
}

interface Script {
  calls: RendererCall[];
  selects: SelectOpts[];
  texts: TextOpts[];
}

function answering(selects: Array<string | null>, texts: Array<string | null> = []): Script {
  const script: Script = { calls: [], selects: [], texts: [] };
  useRenderer({
    ...recordingRenderer(script.calls),
    select: async (value) => {
      script.selects.push(value);
      assert.ok(selects.length > 0, `unexpected select: ${value.message}`);
      return selects.shift() ?? null;
    },
    text: async (value) => {
      script.texts.push(value);
      assert.ok(texts.length > 0, `unexpected text: ${value.message}`);
      return texts.shift() ?? null;
    },
  });
  return script;
}

const said = (script: Script, method: string) =>
  script.calls.filter((call) => call.method === method).map((call) => call.value);

const ios = { id: 11, name: "Monoroll iOS", platform: "ios", bundle_id: "com.example.monoroll", public_api_key: "pk_ios" };
const android = { id: 12, name: "Monoroll Android", platform: "android", public_api_key: "pk_android" };
const opts = { platform: "ios", appName: "Monoroll", bundleId: "com.example.monoroll" };

test("each integration maps to the platform the API expects", () => {
  assert.equal(platformForIntegration(Integration.swift), "ios");
  assert.equal(platformForIntegration(Integration.android), "android");
  assert.equal(platformForIntegration(Integration.flutter), "flutter");
  assert.equal(platformForIntegration(Integration.expo), "react_native");
  assert.equal(platformForIntegration(Integration.reactNative), "react_native");
  assert.equal(platformForIntegration(Integration.web), "web");
});

test("a public key is traced back to its project and app", async () => {
  useHome();
  const { api, listed } = fakeApi([
    { id: 1, name: "Other", applications: [android] },
    { id: 2, name: "Monoroll", applications: [ios] },
    { id: 3 },
  ]);

  assert.deepEqual(await resolveScopeFromKey(api, "pk_ios"), {
    projectId: "2",
    applicationId: "11",
    appName: "Monoroll iOS",
    bundleId: "com.example.monoroll",
  });
  assert.equal(await resolveScopeFromKey(api, "pk_unknown"), null);
  assert.equal(await resolveScopeFromKey(api, ""), null);
  assert.equal(listed(), 2);
});

test("picking a project and its app binds the app's key", async () => {
  useHome();
  const { api } = fakeApi([
    { id: 1, name: "Solo", applications: [android] },
    { id: 2, name: "Monoroll", applications: [android, ios] },
  ]);
  const script = answering(["2", "11"]);

  const binding = await resolveAppBinding(api, opts);

  assert.deepEqual(binding, { apiKey: "pk_ios", app: ios, projectId: "2", applicationId: "11" });
  assert.deepEqual(script.selects, [
    {
      message: "Which Superwall project?",
      options: [
        { value: "1", label: "Solo", hint: "1 app" },
        { value: "2", label: "Monoroll", hint: "2 apps" },
        { value: "__new__", label: "＋ Create a new project" },
      ],
      initialValue: "1",
      footer: "esc cancel",
      transient: true,
    },
    {
      message: "Which app in `Monoroll`?",
      options: [
        { value: "12", label: "Monoroll Android", hint: "Android", disabled: true },
        { value: "11", label: "Monoroll iOS", hint: "iOS · com.example.monoroll", disabled: false },
        { value: "__new_project__", label: "＋ New project with its own iOS app" },
      ],
      initialValue: "11",
      footer: "esc back",
      transient: true,
    },
  ]);
  assert.deepEqual(said(script, "spinner.start"), ["Loading your projects"]);
});

test("going back from the apps returns to the projects with the last one selected", async () => {
  useHome();
  const { api } = fakeApi([
    { id: 1, applications: [{ id: 21 }] },
    { id: 2, name: "Monoroll", applications: [ios] },
  ]);
  const script = answering(["2", null, null]);

  assert.equal(await resolveAppBinding(api, opts), null);

  assert.equal(script.selects[0]?.options[0]?.label, "1");
  assert.equal(script.selects[2]?.initialValue, "2");
});

test("an unnamed app without a key can't be bound", async () => {
  useHome();
  const { api } = fakeApi([{ id: 1, applications: [{ id: 21, platform: "ios" }] }]);
  const script = answering(["1", "21"]);

  assert.equal(await resolveAppBinding(api, opts), null);

  assert.equal(script.selects[1]?.message, "Which app in `this project`?");
  assert.deepEqual(script.selects[1]?.options[0], { value: "21", label: "21", hint: "iOS", disabled: false });
  assert.deepEqual(said(script, "warn"), [
    "`21` has no SDK key yet - pick another or add a new app.",
  ]);
});

test("an account with no projects creates one, then its first app, with the detected bundle id", async () => {
  useHome();
  const created = { id: 31, name: "Monoroll", platform: "ios", public_api_key: "pk_new" };
  const { api, posted } = fakeApi([], {
    project: { id: 5, name: "Monoroll" },
    applications: [[{ id: 30, name: "Other", platform: "android" }, created]],
  });
  const script = answering(["__new__"], [" Monoroll ", " Monoroll ", "  "]);

  const binding = await resolveAppBinding(api, opts);

  assert.deepEqual(binding, { apiKey: "pk_new", app: created, projectId: "5", applicationId: "31" });
  assert.deepEqual(posted, [
    { path: "/v2/projects", body: { name: "Monoroll", organization_id: 7 } },
    {
      path: "/v2/projects/5/applications",
      body: { name: "Monoroll", platform: "ios", bundle_id: "com.example.monoroll" },
    },
  ]);
  assert.equal(script.selects[0]?.message, "No apps in `Monoroll` yet.");
  assert.equal(script.texts[0]?.placeholder, "Monoroll");
  assert.equal(script.texts[0]?.validate?.(" "), "Required");
  assert.equal(script.texts[0]?.validate?.("x"), undefined);
  assert.equal(script.texts[1]?.message, "Name the iOS app");
  assert.equal(script.texts[1]?.validate?.(""), "Required");
  assert.equal(script.texts[1]?.validate?.("x"), undefined);
  assert.equal(script.texts[2]?.placeholder, "com.example.monoroll");
  assert.deepEqual(said(script, "success"), [
    "Created project `Monoroll`",
    "Added iOS app `Monoroll`",
  ]);
});

test("leaving the new-project name with no projects cancels the binding", async () => {
  useHome();
  const { api, posted } = fakeApi([]);
  answering([], [null]);

  assert.equal(await resolveAppBinding(api, opts), null);
  assert.deepEqual(posted, []);
});

test("backing out of a new project from the list returns to the list", async () => {
  useHome();
  const { api } = fakeApi([{ id: 2, name: "Monoroll", applications: [ios] }]);
  const script = answering(["__new__", "2", "11"], [null]);

  const binding = await resolveAppBinding(api, opts);

  assert.equal(binding?.apiKey, "pk_ios");
  assert.equal(script.selects.length, 3);
});

test("a new project the API names nothing keeps the typed name", async () => {
  useHome();
  const created = { id: 31, name: "Mono", platform: "ios", public_api_key: "pk_new" };
  const { api } = fakeApi([{ id: 2, name: "Old", applications: [] }], {
    project: { id: 6 },
    applications: [[created]],
  });
  const script = answering(["__new__", "__new__"], ["Fresh", "Mono", "com.typed.id"]);

  const binding = await resolveAppBinding(api, { platform: "ios", appName: "Mono" });

  assert.equal(binding?.projectId, "6");
  assert.equal(script.selects[1]?.message, "No apps in `Fresh` yet.");
  assert.equal(script.texts[2]?.placeholder, "com.company.app");
  assert.deepEqual(said(script, "success"), ["Created project `Fresh`", "Added iOS app `Mono`"]);
});

test("an empty project goes back to the projects, or round again after backing out of the new app", async () => {
  useHome();
  const created = { id: 41, platform: "ios", public_api_key: "pk_new" };
  const { api, posted } = fakeApi([{ id: 2, name: "Empty", applications: [] }], {
    applications: [[created]],
  });
  const script = answering(["2", null, "2", "__new__", "__new__"], [null, "Mono", "com.example.mono"]);

  const binding = await resolveAppBinding(api, { platform: "ios", appName: "Mono" });

  assert.deepEqual(binding, { apiKey: "pk_new", app: created, projectId: "2", applicationId: "41" });
  assert.deepEqual(posted, [
    { path: "/v2/projects/2/applications", body: { name: "Mono", platform: "ios", bundle_id: "com.example.mono" } },
  ]);
  assert.deepEqual(said(script, "success"), ["Added iOS app `Mono`"]);
});

test("escaping the bundle id asks for the name again, and a missing created app is retried", async () => {
  useHome();
  const created = { id: 51, name: "Mono Web", platform: "web", public_api_key: "pk_web" };
  const { api, posted } = fakeApi([{ id: 2, name: "Monoroll", applications: [ios] }], {
    applications: [[], [{ id: 50, name: "Old", platform: "ios" }, created]],
  });
  const script = answering(
    ["2", "__new__"],
    ["Mono Web", null, "Mono Web", "", "Typo", ""],
  );

  const binding = await resolveAppBinding(api, { platform: "web", appName: "Mono" });

  assert.equal(binding?.apiKey, "pk_web");
  assert.equal(posted.length, 2);
  assert.deepEqual(posted[0]?.body, { name: "Mono Web", platform: "web" });
  assert.deepEqual(said(script, "warn"), ["The app was created but its key didn't come back - try again."]);
  assert.deepEqual(said(script, "success"), ["Added Web app `Mono Web`"]);
  assert.deepEqual(script.selects[1]?.options.at(-1), { value: "__new__", label: "＋ Add a new Web app" });
});

test("the last created app is used when none matches the platform", async () => {
  useHome();
  const last = { id: 61, name: "Renamed", platform: "ios_legacy", public_api_key: "pk_last" };
  const { api } = fakeApi([{ id: 2, name: "Monoroll", applications: [android] }], {
    applications: [[{ id: 60, platform: "android" }, last]],
  });
  answering(["2", "__new__"], ["Mono", ""]);

  const binding = await resolveAppBinding(api, { platform: "ios", appName: "Mono" });

  assert.equal(binding?.apiKey, "pk_last");
});

test("backing out of a new app returns to the apps", async () => {
  useHome();
  const { api } = fakeApi([{ id: 2, name: "Monoroll", applications: [android] }]);
  const script = answering(["2", "__new__", null, null], [null]);

  assert.equal(await resolveAppBinding(api, opts), null);
  assert.equal(script.selects[2]?.message, "Which app in `Monoroll`?");
});

test("a platform already taken in the project gets a new project with its own app", async () => {
  useHome();
  const created = { id: 71, name: "Monoroll", platform: "ios", public_api_key: "pk_fresh" };
  const { api, posted } = fakeApi([{ id: 2, name: "Monoroll", applications: [ios] }], {
    project: { id: 8, name: "Monoroll 2" },
    applications: [[created]],
  });
  const script = answering(
    ["2", "__new_project__", "__new_project__", "__new_project__"],
    [null, "Monoroll 2", null, "Monoroll 2", "Monoroll", ""],
  );

  const binding = await resolveAppBinding(api, opts);

  assert.deepEqual(binding, { apiKey: "pk_fresh", app: created, projectId: "8", applicationId: "71" });
  assert.deepEqual(
    posted.map((post) => post.path),
    ["/v2/projects", "/v2/projects", "/v2/projects/8/applications"],
  );
  assert.equal(script.selects.length, 4);
});
