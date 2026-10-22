import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { boundOrganization, chooseApp, pickOrganization, pickProject, pickScope } from "@/core/account/scope";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import type { Application, Project } from "@/core/api/resources";
import { readDefaultApp, writeDefaultApp } from "@/core/state/config";
import type { CommandContext } from "@/program/command";
import { createCommandOutput, type OutputMode } from "@/program/output";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import type { SelectOpts } from "@/ui/types";
import { clearHomes, useHome } from "../../helpers/home";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const dirs: string[] = [];

afterEach(() => {
  clearHomes();
  selectRenderer({ mode: "text" });
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const ios: Application = { id: 11, name: "Monoroll iOS", platform: "ios", public_api_key: "pk_monoroll_ios" };
const android: Application = { id: 12, name: "Monoroll Android", platform: "android" };
const web: Application = { id: 13, name: "Monoroll", platform: "web" };
const monoroll: Project = { id: 1, name: "Monoroll", organization_id: 7, applications: [ios, android] };
const solo: Project = { id: 2, name: "Solo", organization_id: 7, applications: [{ id: 21, name: "Solo" }] };
const partner: Project = { id: 3, name: "Partner", organization_id: 9, applications: [web] };

function fakeApi(projects: Project[], gets: Record<string, unknown> = {}): { api: SuperwallApi; requested: string[] } {
  const requested: string[] = [];
  const api = {
    list: async (requestPath: string) => (requested.push(`LIST ${requestPath}`), projects),
    get: async (requestPath: string) => {
      requested.push(`GET ${requestPath}`);
      if (requestPath in gets) return gets[requestPath];
      throw new ApiError(`GET ${requestPath}`, 404, "not found");
    },
  };
  return { api: api as unknown as SuperwallApi, requested };
}

interface Workspace {
  dir: string;
  lock(contents: unknown, nested?: boolean): void;
  app(source: string): void;
}

function useWorkspace(): Workspace {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-scope-"));
  dirs.push(dir);
  return {
    dir,
    lock(contents, nested = false) {
      const at = nested ? path.join(dir, "superwall") : dir;
      fs.mkdirSync(at, { recursive: true });
      fs.writeFileSync(path.join(at, "superwall.lock"), typeof contents === "string" ? contents : JSON.stringify(contents));
    },
    app(source) {
      fs.mkdirSync(path.join(dir, "Monoroll"), { recursive: true });
      fs.writeFileSync(path.join(dir, "Monoroll", "Package.swift"), "// swift-tools-version:5.9\n");
      fs.writeFileSync(path.join(dir, "Monoroll", "App.swift"), source);
    },
  };
}

interface Asked {
  ctx: CommandContext;
  calls: RendererCall[];
  selects: SelectOpts[];
}

function contextFor(
  options: {
    app?: string;
    project?: string;
    interactive?: boolean;
    installDir?: string;
    answers?: Array<string | null>;
    outputMode?: OutputMode;
  } = {},
): Asked {
  useHome();
  const calls: RendererCall[] = [];
  const selects: SelectOpts[] = [];
  const answers = [...(options.answers ?? [])];
  const ui = {
    ...recordingRenderer(calls),
    select: async (value: SelectOpts) => {
      selects.push(value);
      assert.ok(answers.length > 0, `unexpected select: ${value.message}`);
      return answers.shift() ?? null;
    },
  };
  useRenderer(ui);
  const outputMode = options.outputMode ?? "text";
  return {
    ctx: {
      ui,
      output: createCommandOutput(outputMode, ui),
      outputMode,
      interactive: options.interactive ?? false,
      installDir: options.installDir ?? useWorkspace().dir,
      json: false,
      dryRun: false,
      target: { app: options.app, project: options.project },
      fail: () => {
        process.exitCode = 1;
      },
    },
    calls,
    selects,
  };
}

const said = (calls: RendererCall[], method: string) =>
  calls.filter((call) => call.method === method).map((call) => call.value);

test("--app names an app by id and remembers it as the project's default", async () => {
  const { ctx } = contextFor({ app: "12" });
  const { api } = fakeApi([monoroll, solo]);

  assert.deepEqual(await pickScope(ctx, api, true), {
    projectId: "1",
    applicationId: "12",
    projectName: "Monoroll",
    appName: "Monoroll Android",
    appPlatform: "android",
    projectCount: 2,
    appCount: 2,
  });
  assert.equal(readDefaultApp("1"), "12");
});

test("a project-scoped command keeps only the project of the named app", async () => {
  const { ctx } = contextFor({ app: "Solo" });
  const { api } = fakeApi([monoroll, solo]);

  assert.deepEqual(await pickScope(ctx, api, false), {
    projectId: "2",
    applicationId: undefined,
    projectName: "Solo",
    appName: undefined,
    appPlatform: undefined,
    projectCount: 2,
    appCount: 1,
  });
});

test("loading projects shows a spinner only in the rich renderer", async () => {
  const rich = contextFor({ app: "11", outputMode: "rich" });
  await pickScope(rich.ctx, fakeApi([monoroll]).api, true);
  assert.deepEqual(said(rich.calls, "spinner.start"), ["Loading projects"]);

  const text = contextFor({ app: "11" });
  await pickScope(text.ctx, fakeApi([monoroll]).api, true);
  assert.deepEqual(said(text.calls, "spinner.start"), []);
});

test("--app with --project looks the app up in that project, by id or name", async () => {
  const { ctx } = contextFor({ app: "Monoroll iOS", project: "1" });
  const { api } = fakeApi([monoroll, solo]);

  const scope = await pickScope(ctx, api, true);

  assert.equal(scope.applicationId, "11");
  await assert.rejects(
    pickScope(contextFor({ app: "21", project: "1" }).ctx, api, true),
    /^Error: No app 21 in Monoroll\.$/,
  );
  await assert.rejects(
    pickScope(contextFor({ app: "21", project: "4" }).ctx, fakeApi([], { "/v2/projects/4": { id: 4 } }).api, true),
    /^Error: No app 21 in 4\.$/,
  );
});

test("an app nobody can find says how to name it", async () => {
  const { ctx } = contextFor({ app: "Nope" });

  await assert.rejects(pickScope(ctx, fakeApi([monoroll]).api, true), /No app Nope that this account can open/);
});

test("--project that can't be opened is refused", async () => {
  const { ctx } = contextFor({ project: "99" });
  const { api, requested } = fakeApi([monoroll, solo]);

  await assert.rejects(pickScope(ctx, api, true), /^Error: No project 99 that this account can open\.$/);
  assert.deepEqual(requested, ["LIST /v2/projects", "GET /v2/projects/99"]);
});

test("an app bound in superwall.lock is used without asking", async () => {
  const workspace = useWorkspace();
  workspace.lock({ apps: { web: 7, ios: "11" } });
  const { ctx, calls } = contextFor({ installDir: workspace.dir });

  const scope = await pickScope(ctx, fakeApi([solo, monoroll]).api, true);

  assert.equal(scope.applicationId, "11");
  assert.deepEqual(said(calls, "info"), ["Using `Monoroll iOS` - bound in superwall.lock."]);
});

test("a lock that only names a paywall finds its app through the paywall", async () => {
  const workspace = useWorkspace();
  workspace.lock(
    { paywalls: { home: { ios: { paywallId: 7 }, android: { paywallId: "pw_nested" } }, other: { paywallId: "pw_later" } } },
    true,
  );
  const { ctx, calls } = contextFor({ installDir: workspace.dir });
  const { api, requested } = fakeApi([monoroll, partner], {
    "/v2/paywalls/pw_nested": { id: "pw_nested", application_id: 13 },
  });

  const scope = await pickScope(ctx, api, true);

  assert.equal(scope.applicationId, "13");
  assert.equal(requested.includes("GET /v2/paywalls/pw_later"), false);
  assert.deepEqual(said(calls, "info"), ["Using `Monoroll` - bound in superwall.lock."]);
});

test("a funnel's own paywall id wins over its bindings", async () => {
  const workspace = useWorkspace();
  workspace.lock({ funnels: { onboarding: { paywallId: "pw_funnel", ios: { paywallId: "pw_binding" } } } });
  const { ctx } = contextFor({ installDir: workspace.dir });
  const { api, requested } = fakeApi([monoroll], {
    "/v2/paywalls/pw_funnel": { id: "pw_funnel", application_id: "12" },
  });

  const scope = await pickScope(ctx, api, true);

  assert.equal(scope.applicationId, "12");
  assert.equal(requested.includes("GET /v2/paywalls/pw_binding"), false);
});

test("a lock that leads nowhere falls back to choosing", async () => {
  for (const contents of [
    "{not json",
    { apps: { ios: "404" } },
    { paywalls: { home: { paywallId: "pw_gone" } } },
    { paywalls: { home: null } },
    {},
  ]) {
    const workspace = useWorkspace();
    workspace.lock(contents);
    const { ctx, calls } = contextFor({ installDir: workspace.dir });

    const scope = await pickScope(ctx, fakeApi([solo]).api, true);

    assert.equal(scope.applicationId, "21");
    assert.deepEqual(said(calls, "info"), []);
  }
});

test("--project wins over the lock", async () => {
  const workspace = useWorkspace();
  workspace.lock({ apps: { ios: "11" } });
  const { ctx } = contextFor({ installDir: workspace.dir, project: "2" });

  assert.equal((await pickScope(ctx, fakeApi([monoroll, solo]).api, true)).projectId, "2");
});

test("an account with no projects is told how to make one", async () => {
  const { ctx } = contextFor();

  await assert.rejects(pickScope(ctx, fakeApi([]).api, true), /No projects yet - run `superwall apps create/);
});

test("a single project without apps scopes to the project alone", async () => {
  const { ctx } = contextFor();

  assert.deepEqual(await pickScope(ctx, fakeApi([{ id: 5 }]).api, true), {
    projectId: "5",
    applicationId: undefined,
    projectName: undefined,
    appName: undefined,
    appPlatform: undefined,
    projectCount: 1,
    appCount: 0,
  });
});

test("several apps and nobody to ask lists them with their platforms", async () => {
  const { ctx } = contextFor();

  await assert.rejects(
    pickScope(ctx, fakeApi([{ id: 1, applications: [ios, { id: 14 }] }]).api, true),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "1 has 2 apps - pass --app <id>:\n  11  iOS  Monoroll iOS\n  14",
  );
});

test("several apps and someone to ask offers the remembered default first and remembers the choice", async () => {
  const { ctx, selects } = contextFor({ interactive: true, answers: ["11"] });
  writeDefaultApp("1", "12");

  const scope = await pickScope(ctx, fakeApi([monoroll]).api, true);

  assert.equal(scope.applicationId, "11");
  assert.deepEqual(selects, [
    {
      message: "Which app?",
      options: [
        { value: "12", label: "Monoroll Android", hint: "Android" },
        { value: "11", label: "Monoroll iOS", hint: "iOS" },
      ],
      initialValue: "12",
    },
  ]);
  assert.equal(readDefaultApp("1"), "11");
});

test("the app detected in this directory is offered first, by key or by name", async () => {
  const byKey = useWorkspace();
  byKey.app('Superwall.configure(apiKey: "pk_monoroll_ios")\n');
  const keyed = contextFor({ interactive: true, installDir: byKey.dir, answers: ["11"] });
  await chooseApp(keyed.ctx, [android, ios], android);
  assert.equal(keyed.selects[0]?.initialValue, "11");
  assert.equal(keyed.selects[0]?.options[0]?.value, "11");

  const byName = useWorkspace();
  byName.app("Superwall.configure(apiKey: \"pk_other_key\")\n");
  const named = contextFor({ interactive: true, installDir: byName.dir, answers: ["13"] });
  assert.equal(await chooseApp(named.ctx, [ios, web], ios), web);
  assert.equal(named.selects[0]?.initialValue, "13");

  const nameless = useWorkspace();
  nameless.app("// no key here\n");
  const plain = contextFor({ interactive: true, installDir: nameless.dir, answers: ["14"] });
  const unnamed = { id: 14 };
  assert.equal(await chooseApp(plain.ctx, [ios, unnamed], ios), unnamed);
  assert.deepEqual(plain.selects[0]?.options[1], { value: "14", label: "14", hint: "?" });
});

test("escaping the app choice cancels, and an unknown answer keeps the default", async () => {
  const cancelled = contextFor({ interactive: true, answers: [null] });
  await assert.rejects(chooseApp(cancelled.ctx, [ios, android], ios), /^Error: Cancelled\.$/);

  const unknown = contextFor({ interactive: true, answers: ["999"] });
  assert.equal(await chooseApp(unknown.ctx, [ios, android], android), android);
});

test("the project holding this directory's key is used without asking", async () => {
  const workspace = useWorkspace();
  workspace.app('Superwall.configure(apiKey: "pk_monoroll_ios")\n');
  const { ctx, calls } = contextFor({ installDir: workspace.dir });

  const project = await pickProject(ctx, fakeApi([]).api, [solo, monoroll]);

  assert.equal(project, monoroll);
  assert.deepEqual(said(calls, "info"), ["Using `Monoroll` - detected in this directory."]);
});

test("several projects and nobody to ask lists the first ten", async () => {
  const projects: Project[] = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    ...(index === 0 ? { name: "First", applications: [{ id: 101 }, { id: 102 }] } : {}),
  }));
  const { ctx } = contextFor();

  await assert.rejects(pickProject(ctx, fakeApi([]).api, projects), (error: unknown) => {
    assert.ok(error instanceof Error);
    const lines = error.message.split("\n");
    assert.equal(lines[0], "You can open 12 projects - pass --app <id|dashboard link> or --project <id>:");
    assert.equal(lines[1], "  1  First  (apps 101, 102)");
    assert.equal(lines[2], "  2");
    assert.equal(lines[11], "  …and 2 more: `superwall apps list` lists them all.");
    assert.equal(lines.length, 12);
    return true;
  });
});

test("choosing a project offers the one named like this directory first", async () => {
  const workspace = useWorkspace();
  workspace.app("// no key\n");
  const { ctx, selects } = contextFor({ interactive: true, installDir: workspace.dir, answers: ["1"] });

  assert.equal(await pickProject(ctx, fakeApi([]).api, [solo, monoroll]), monoroll);
  assert.deepEqual(selects, [
    {
      message: "Which project?",
      options: [
        { value: "1", label: "Monoroll" },
        { value: "2", label: "Solo" },
      ],
      initialValue: "1",
    },
  ]);
});

test("a project holding an app named like this directory is offered first", async () => {
  const workspace = useWorkspace();
  workspace.app("// no key\n");
  const { ctx, selects } = contextFor({ interactive: true, installDir: workspace.dir, answers: ["3"] });

  await pickProject(ctx, fakeApi([]).api, [solo, partner]);

  assert.equal(selects[0]?.initialValue, "3");
  assert.equal(selects[0]?.options[0]?.value, "3");
});

test("choosing a project with nothing detected keeps the order, and escaping cancels", async () => {
  const { ctx, selects } = contextFor({ interactive: true, answers: ["2", null, "9"] });
  const unnamed: Project = { id: 4 };

  assert.equal(await pickProject(ctx, fakeApi([]).api, [unnamed, solo]), solo);
  assert.deepEqual(selects[0], {
    message: "Which project?",
    options: [
      { value: "4", label: "4" },
      { value: "2", label: "Solo" },
    ],
    initialValue: undefined,
  });
  await assert.rejects(pickProject(ctx, fakeApi([]).api, [unnamed, solo]), /^Error: Cancelled\.$/);
  await assert.rejects(pickProject(ctx, fakeApi([]).api, [unnamed, solo]), /^Error: No project 9\.$/);
});

test("the bound organization comes from --app, --project or the lock", async () => {
  assert.equal(await boundOrganization(contextFor({ app: "13" }).ctx, fakeApi([monoroll, partner]).api), "9");
  assert.equal(await boundOrganization(contextFor({ project: "1" }).ctx, fakeApi([monoroll, partner]).api), "7");

  const workspace = useWorkspace();
  workspace.lock({ apps: { ios: "13" } });
  assert.equal(
    await boundOrganization(contextFor({ installDir: workspace.dir }).ctx, fakeApi([monoroll, partner]).api),
    "9",
  );

  assert.equal(await boundOrganization(contextFor().ctx, fakeApi([monoroll, partner]).api), undefined);
});

test("a bound project without its organization is looked up", async () => {
  const { api, requested } = fakeApi([{ id: 6, applications: [{ id: 61 }] }], {
    "/v2/projects/6": { id: 6, organization_id: 70 },
  });

  assert.equal(await boundOrganization(contextFor({ app: "61" }).ctx, api), "70");
  assert.ok(requested.includes("GET /v2/projects/6"));
});

test("the organization is the bound one, or the only one the apps live in", async () => {
  assert.equal(await pickOrganization(contextFor({ app: "13" }).ctx, fakeApi([monoroll, partner]).api), "9");
  assert.equal(await pickOrganization(contextFor().ctx, fakeApi([monoroll, solo]).api), "7");
  await assert.rejects(
    pickOrganization(contextFor().ctx, fakeApi([{ id: 5 }]).api),
    /No projects yet - run `superwall apps create/,
  );
});

test("apps in several organizations and nobody to ask names each with an example app", async () => {
  const { api } = fakeApi([monoroll, partner, { id: 4, organization_id: 11 }], {
    "/v2/me/organizations": { data: [{ id: 7, name: "Acme" }] },
  });

  await assert.rejects(pickOrganization(contextFor().ctx, api), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      "Your apps are in 3 organizations - pass --app <id|dashboard link> to say whose:\n" +
        "  Acme  e.g. --app 11\n" +
        "  Organization 9  e.g. --app 13\n" +
        "  Organization 11",
    );
    return true;
  });
});

test("apps in several organizations and someone to ask lets them choose", async () => {
  const { ctx, selects } = contextFor({ interactive: true, answers: ["9"] });
  const { api } = fakeApi([monoroll, partner], {
    "/v2/me/organizations": { data: [{ id: 7, name: "Acme" }] },
    "/v2/organizations/9": { id: 9, name: "Partner Inc" },
  });

  assert.equal(await pickOrganization(ctx, api), "9");
  assert.equal(selects[0]?.message, "Whose apps?");
  assert.deepEqual(
    selects[0]?.options.map((option) => option.label),
    ["Acme", "Partner Inc"],
  );
});

test("a directory that can't be scanned detects nothing", async () => {
  const workspace = useWorkspace();
  const notADirectory = path.join(workspace.dir, "file");
  fs.writeFileSync(notADirectory, "");
  const { ctx, selects } = contextFor({ interactive: true, installDir: notADirectory, answers: ["1"] });

  await pickProject(ctx, fakeApi([]).api, [solo, monoroll]);

  assert.equal(selects[0]?.initialValue, undefined);
  assert.equal(selects[0]?.options[0]?.value, "2");
});
