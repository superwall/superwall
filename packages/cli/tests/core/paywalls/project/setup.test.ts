import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { AppBindingError } from "@/core/paywalls/binding/apps";
import {
  alreadyAProject,
  connectApp,
  detectHostApp,
  detectPackageManager,
  devCommand,
  initGit,
  installDependencies,
  uniqueSurfaceId,
} from "@/core/paywalls/project/setup";
import { restoreBin, useBin } from "../../../helpers/bin";
import { restoreFetch, useFetch, type Route } from "../../../helpers/fetch";
import { clearHomes, useHome } from "../../../helpers/home";
import { answeringRenderer, said } from "../../../helpers/answers";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

const originalAgent = process.env.npm_config_user_agent;
const originalKey = process.env.SUPERWALL_API_KEY;
const originalHost = process.env.SUPERWALL_API_HOST;

beforeEach(() => {
  delete process.env.npm_config_user_agent;
});

afterEach(() => {
  restoreBin();
  restoreFetch();
  clearHomes();
  if (originalAgent === undefined) delete process.env.npm_config_user_agent;
  else process.env.npm_config_user_agent = originalAgent;
  if (originalKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = originalKey;
  if (originalHost === undefined) delete process.env.SUPERWALL_API_HOST;
  else process.env.SUPERWALL_API_HOST = originalHost;
});

function scratch(name: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`)));
}

function tool(log: string, name: string, exits: Record<string, number> = {}): string {
  const cases = Object.entries(exits)
    .map(([arg, code]) => `  ${arg}) exit ${code} ;;`)
    .join("\n");
  return `echo "${name} $* @ $(pwd -P)" >> "${log}"\ncase "$1" in\n${cases}\nesac\nexit 0`;
}

function onlyTools(log: string, tools: Record<string, Record<string, number>>): void {
  const bins = Object.fromEntries(
    Object.entries(tools).map(([name, exits]) => [name, tool(log, name, exits)]),
  );
  process.env.PATH = useBin(bins);
}

function ran(log: string): string[] {
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
}

function signIn(routes: Route[]): ReturnType<typeof useFetch> {
  useHome();
  process.env.SUPERWALL_API_KEY = "sk_test_setup";
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  return useFetch(routes);
}

function projects(...list: unknown[]): Route {
  return { match: "/v2/projects", body: { data: list, has_more: false } };
}

function lockApps(target: string): Record<string, string> | undefined {
  const file = path.join(target, "superwall.lock");
  if (!fs.existsSync(file)) return undefined;
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { apps: Record<string, string> }).apps;
}

function expoApp(root: string, source: string): void {
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { expo: "51.0.0", "expo-superwall": "1.0.0" } }),
  );
  fs.writeFileSync(path.join(root, "App.tsx"), source);
}

test("a superwall/ directory holding some other package is refused, not overwritten", () => {
  const root = scratch("foreign");
  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "package.json"), "{}");
  assert.match(alreadyAProject(root) ?? "", /isn't a superwall project/);
});

test("a superwall/ directory that is already a project points at superwall dev", () => {
  const root = scratch("nested");
  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "superwall.lock"), "{}");
  assert.equal(
    alreadyAProject(root),
    `\`${path.join(root, "superwall")}\` is already a superwall project — run \`superwall dev\` to open it.`,
  );
});

test("a superwall/ directory with only leftover subdirectories does not block setup", () => {
  const root = scratch("leftover");
  fs.mkdirSync(path.join(root, "superwall", "paywalls"), { recursive: true });
  assert.equal(alreadyAProject(root), undefined);
});

test("a bare superwall project root is recognized by its markers", () => {
  const bare = scratch("bare");
  fs.writeFileSync(path.join(bare, "superwall.lock"), "{}");
  assert.match(alreadyAProject(bare) ?? "", /already a superwall project/);

  const config = scratch("config");
  fs.writeFileSync(path.join(config, "superwall.config.ts"), "export default {};\n");
  assert.equal(
    alreadyAProject(config),
    `\`${config}\` is already a superwall project — run \`superwall dev\` to open it.`,
  );

  const byDep = scratch("dep");
  fs.writeFileSync(
    path.join(byDep, "package.json"),
    JSON.stringify({ dependencies: { superwall: "latest" } }),
  );
  assert.match(alreadyAProject(byDep) ?? "", /already a superwall project/);
});

test("an empty superwall/ directory does not block setup", () => {
  const root = scratch("fresh");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.mkdirSync(path.join(root, "superwall"));

  assert.equal(alreadyAProject(root), undefined);
});

test("the app's lockfile picks the package manager, probed with --version", async () => {
  const root = scratch("pnpm");
  const log = path.join(scratch("log"), "ran.log");
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
  onlyTools(log, { pnpm: {}, bun: {} });

  assert.equal(await detectPackageManager(root), "pnpm");
  assert.deepEqual(ran(log), [`pnpm --version @ ${fs.realpathSync(process.cwd())}`]);
});

test("a lockfile whose manager is not installed falls through to the next one that is", async () => {
  const root = scratch("yarn-missing");
  const log = path.join(scratch("log"), "ran.log");
  fs.writeFileSync(path.join(root, "yarn.lock"), "");
  fs.writeFileSync(path.join(root, "bun.lockb"), "");
  onlyTools(log, { yarn: { "--version": 1 }, bun: {} });

  assert.equal(await detectPackageManager(root), "bun");
  assert.deepEqual(
    ran(log).map((line) => line.split(" @ ")[0]),
    ["bun --version"],
  );
});

test("without a lockfile, the manager that ran the CLI is preferred over bun", async () => {
  const root = scratch("agent");
  process.env.npm_config_user_agent = "yarn/4.1.0 npm/? node/v22.15.1 darwin arm64";
  onlyTools(path.join(scratch("log"), "ran.log"), { yarn: {}, bun: {} });

  assert.equal(await detectPackageManager(root), "yarn");
});

test("with nothing installed the manager falls back to npm", async () => {
  const root = scratch("none");
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
  onlyTools(path.join(scratch("log"), "ran.log"), {});

  assert.equal(await detectPackageManager(root), "npm");
});

test("npm runs scripts with run; every other manager runs them directly", () => {
  assert.equal(devCommand("npm"), "npm run dev");
  assert.equal(devCommand("bun"), "bun dev");
  assert.equal(devCommand("pnpm"), "pnpm dev");
});

test("installing runs the manager's install inside superwall/ and reports it", async () => {
  const target = scratch("install");
  const log = path.join(scratch("log"), "ran.log");
  onlyTools(log, { bun: {} });
  const calls: RendererCall[] = [];

  assert.equal(await installDependencies(recordingRenderer(calls), target, "bun"), true);
  assert.deepEqual(ran(log), [`bun install @ ${target}`]);
  assert.deepEqual(calls, [
    { method: "spinner.start", value: "Installing dependencies with bun" },
    { method: "spinner.stop", value: "Dependencies installed" },
  ]);
});

test("a failed install never fails the command, it says how to finish by hand", async () => {
  const target = scratch("install-fail");
  onlyTools(path.join(scratch("log"), "ran.log"), { pnpm: { install: 1 } });
  const calls: RendererCall[] = [];

  assert.equal(await installDependencies(recordingRenderer(calls), target, "pnpm"), false);
  assert.deepEqual(said(calls, "spinner.stop"), [
    "`pnpm install` failed — run it yourself in superwall/",
  ]);
});

test("without git on the machine, no repository is created", async () => {
  const root = scratch("no-git");
  onlyTools(path.join(scratch("log"), "ran.log"), {});
  const calls: RendererCall[] = [];

  await initGit(recordingRenderer(calls), root);
  assert.deepEqual(calls, []);
});

test("an app already in a git repository is left to its own history", async () => {
  const root = scratch("in-repo");
  const log = path.join(scratch("log"), "ran.log");
  onlyTools(log, { git: {} });
  const calls: RendererCall[] = [];

  await initGit(recordingRenderer(calls), root);
  assert.deepEqual(
    ran(log).map((line) => line.split(" @ ")[0]),
    ["git --version", "git rev-parse --is-inside-work-tree"],
  );
  assert.deepEqual(calls, []);
});

test("an app outside git gets a repository with the scaffold committed", async () => {
  const root = scratch("new-repo");
  const log = path.join(scratch("log"), "ran.log");
  onlyTools(log, { git: { "rev-parse": 128 } });
  const calls: RendererCall[] = [];

  await initGit(recordingRenderer(calls), root);
  assert.deepEqual(ran(log).slice(2), [
    `git init --quiet @ ${root}`,
    `git add -A @ ${root}`,
    `git commit --quiet -m New superwall project @ ${root}`,
  ]);
  assert.deepEqual(said(calls, "step"), ["Initialized a git repository"]);
});

test("a commit git refuses leaves the scaffold in place without failing", async () => {
  const root = scratch("commit-fail");
  onlyTools(path.join(scratch("log"), "ran.log"), { git: { "rev-parse": 128, commit: 1 } });
  const calls: RendererCall[] = [];

  await initGit(recordingRenderer(calls), root);
  assert.deepEqual(calls, []);
});

test("the host app and its existing Superwall setup are detected", async () => {
  const root = path.join(scratch("host"), "my-app");
  fs.mkdirSync(root);
  expoApp(root, 'export default () => <SuperwallProvider apiKeys={{ ios: "pk_abcdef123456" }} />;\n');

  const detected = await detectHostApp(root);
  assert.equal(detected?.app.name, "my-app");
  assert.deepEqual(detected?.existing, {
    sdkInstalled: true,
    configureFound: true,
    apiKey: "pk_abcdef123456",
    fullyIntegrated: true,
  });
});

test("a directory with no app in it, or one that cannot be scanned, detects nothing", async () => {
  assert.equal(await detectHostApp(scratch("empty")), undefined);
  const file = path.join(scratch("file"), "not-a-dir");
  fs.writeFileSync(file, "");
  assert.equal(await detectHostApp(file), undefined);
});

const twoApps = projects({
  id: 9,
  name: "P",
  applications: [
    { id: 1, name: "A", platform: "ios" },
    { id: 2, name: "B", platform: "android" },
  ],
});

test("an app id binds that app without asking, even among several", async () => {
  signIn([twoApps]);
  const target = scratch("by-id");
  const calls: RendererCall[] = [];

  await connectApp(recordingRenderer(calls), true, target, target, undefined, "2");
  assert.deepEqual(lockApps(target), { android: "2" });
  assert.deepEqual(said(calls, "success"), [
    "Pushes go to `B` — saved in superwall.lock, so commit that file.",
  ]);
  assert.deepEqual(said(calls, "select"), []);
});

test("an app without a name is named by its id", async () => {
  signIn([projects({ id: 9, applications: [{ id: 5, platform: "web" }] })]);
  const target = scratch("unnamed");
  const calls: RendererCall[] = [];

  await connectApp(recordingRenderer(calls), false, target, target, undefined, "5");
  assert.deepEqual(lockApps(target), { web: "5" });
  assert.match(said(calls, "success")[0] ?? "", /^Pushes go to `5`/);
});

test("an app in an organization the account can open but isn't a member of still binds", async () => {
  signIn([
    { match: "/v2/paywalls?application_id=88", body: { data: [{ project_id: 20 }] } },
    { match: "/v2/projects/20", body: { id: 20, name: "Theirs", applications: [{ id: 88, name: "C", platform: "ios" }] } },
    twoApps,
  ]);
  const target = scratch("other-org");
  const calls: RendererCall[] = [];

  await connectApp(recordingRenderer(calls), false, target, target, undefined, "88");
  assert.deepEqual(lockApps(target), { ios: "88" });
  assert.deepEqual(said(calls, "success"), [
    "Pushes go to `C` — saved in superwall.lock, so commit that file.",
  ]);
});

test("an app id the account does not have fails with where to look", async () => {
  signIn([twoApps]);
  const target = scratch("missing-id");

  await assert.rejects(
    connectApp(recordingRenderer(), false, target, target, undefined, "77"),
    /No app with id `77` in this account — run `superwall apps` to list them\./,
  );
  assert.equal(lockApps(target), undefined);
});

test("an API key already in the app binds the app it belongs to", async () => {
  const root = path.join(scratch("keyed"), "my-app");
  fs.mkdirSync(root);
  expoApp(root, 'Superwall.configure({ apiKey: "pk_matching_key" });\n');
  const detected = await detectHostApp(root);
  signIn([
    projects(
      { id: 9, applications: [{ id: 1, name: "Other", platform: "ios", public_api_key: "pk_other_key" }] },
      { id: 10, applications: [{ id: 42, name: "Keyed", platform: "ios", public_api_key: "pk_matching_key" }] },
    ),
  ]);
  const target = scratch("keyed-target");
  const calls: RendererCall[] = [];

  await connectApp(recordingRenderer(calls), false, root, target, detected, undefined);
  assert.deepEqual(lockApps(target), { ios: "42" });
  assert.deepEqual(said(calls, "success"), [
    "`my-app` is already on Superwall as `Keyed` — pushes go there. Saved in superwall.lock; commit that file.",
  ]);
});

test("a keyed app without a name is named by its id", async () => {
  const root = path.join(scratch("keyed-unnamed"), "my-app");
  fs.mkdirSync(root);
  expoApp(root, 'Superwall.configure({ apiKey: "pk_matching_key" });\n');
  const detected = await detectHostApp(root);
  signIn([
    projects({ id: 9, applications: [{ id: 42, platform: "android", public_api_key: "pk_matching_key" }] }),
  ]);
  const target = scratch("keyed-unnamed-target");
  const calls: RendererCall[] = [];

  await connectApp(recordingRenderer(calls), false, root, target, detected, undefined);
  assert.deepEqual(lockApps(target), { android: "42" });
  assert.match(said(calls, "success")[0] ?? "", /as `42` — pushes go there/);
});

test("a key the account does not know says so, then binds the account's only app", async () => {
  const root = path.join(scratch("stranger"), "my-app");
  fs.mkdirSync(root);
  expoApp(root, 'Superwall.configure({ apiKey: "pk_unknown_key" });\n');
  const detected = await detectHostApp(root);
  signIn([
    projects({ id: 9, applications: [{ id: 7, name: "Only", platform: "ios", public_api_key: "pk_other_key" }] }),
  ]);
  const target = scratch("stranger-target");
  const calls: RendererCall[] = [];

  await connectApp(recordingRenderer(calls), false, root, target, detected, undefined);
  assert.deepEqual(said(calls, "info"), [
    "Found a Superwall API key in the app, but no matching app in this account — pick one instead.",
  ]);
  assert.deepEqual(lockApps(target), { ios: "7" });
});

test("a key whose app vanishes from the second listing cannot be bound to a platform", async () => {
  const root = path.join(scratch("vanish"), "my-app");
  fs.mkdirSync(root);
  expoApp(root, 'Superwall.configure({ apiKey: "pk_matching_key" });\n');
  const detected = await detectHostApp(root);
  signIn([]);
  let listings = 0;
  globalThis.fetch = (async () => {
    listings += 1;
    if (listings > 1) throw new Error("offline");
    return Response.json({
      data: [{ id: 9, applications: [{ id: 42, platform: "ios", public_api_key: "pk_matching_key" }] }],
      has_more: false,
    });
  }) as typeof fetch;
  const target = scratch("vanish-target");

  await assert.rejects(
    connectApp(recordingRenderer(), false, root, target, detected, undefined),
    AppBindingError,
  );
  assert.equal(lockApps(target), undefined);
});

test("a key lookup that cannot reach the API ends in the API's own error", async () => {
  const root = path.join(scratch("offline"), "my-app");
  fs.mkdirSync(root);
  expoApp(root, 'Superwall.configure({ apiKey: "pk_matching_key" });\n');
  const detected = await detectHostApp(root);
  signIn([{ match: "/v2/projects", fail: true }]);
  const calls: RendererCall[] = [];

  await assert.rejects(
    connectApp(recordingRenderer(calls), false, root, scratch("offline-target"), detected, undefined),
    /Couldn't reach the Superwall API/,
  );
  assert.equal(said(calls, "info").length, 1);
});

test("several apps and nobody to ask leaves the choice to the first push", async () => {
  signIn([twoApps]);
  const target = scratch("several");
  const calls: RendererCall[] = [];

  await connectApp(recordingRenderer(calls), false, target, target, undefined, undefined);
  assert.equal(lockApps(target), undefined);
  assert.deepEqual(said(calls, "info"), [
    "Several apps in your account — the first `superwall push` will ask which one.",
  ]);
});

test("several apps interactively offer each one by name, bundle id or id, plus a new app", async () => {
  signIn([
    projects({
      id: 9,
      applications: [
        { id: 1, name: "A", platform: "ios" },
        { id: 2, bundle_id: "com.example.b", platform: "android" },
        { id: 3, platform: "web" },
      ],
    }),
  ]);
  const target = scratch("pick");
  const calls: RendererCall[] = [];

  await connectApp(answeringRenderer({ select: ["2"] }, calls), true, target, target, undefined, undefined);
  const [prompt] = calls.filter((call) => call.method === "select");
  assert.deepEqual(prompt?.value, {
    message: "Which app should these paywalls push to?",
    options: [
      { value: "1", label: "A", hint: "iOS" },
      { value: "2", label: "com.example.b", hint: "Android" },
      { value: "3", label: "3", hint: "Web" },
      { value: "__new__", label: "Create a new app" },
    ],
  });
  assert.deepEqual(lockApps(target), { android: "2" });
  assert.deepEqual(said(calls, "success"), [
    "Pushes go to `2` — saved in superwall.lock, so commit that file.",
  ]);
});

test("cancelling the app choice binds nothing", async () => {
  signIn([twoApps]);
  const target = scratch("pick-cancel");
  const calls: RendererCall[] = [];

  await connectApp(answeringRenderer({ select: [null] }, calls), true, target, target, undefined, undefined);
  assert.equal(lockApps(target), undefined);
  assert.deepEqual(said(calls, "success"), []);
});

test("choosing a new app creates it in the only project and binds it", async () => {
  const log = signIn([
    { match: "/v2/projects/9/applications", body: { id: 77, name: "Acme App", platform: "ios" } },
    twoApps,
  ]);
  const root = path.join(scratch("new-app"), "acme_app");
  const target = scratch("new-app-target");
  const calls: RendererCall[] = [];

  await connectApp(
    answeringRenderer({ select: ["__new__", "ios"], text: [" Acme App "] }, calls),
    true,
    root,
    target,
    undefined,
    undefined,
  );

  const question = calls.find((call) => call.method === "text")?.value as {
    message: string;
    initialValue: string;
    validate: (value: string) => string | undefined;
  };
  assert.equal(question.message, "What is the app called?");
  assert.equal(question.initialValue, "Acme App");
  assert.equal(question.validate("  "), "Give the app a name.");
  assert.equal(question.validate("Acme"), undefined);
  const platforms = calls.filter((call) => call.method === "select")[1]?.value as {
    options: Array<{ value: string; label: string }>;
  };
  assert.deepEqual(platforms.options, [
    { value: "ios", label: "iOS" },
    { value: "android", label: "Android" },
    { value: "flutter", label: "Flutter" },
    { value: "react_native", label: "React Native" },
    { value: "web", label: "Web" },
  ]);
  const created = log.find((entry) => entry.method === "POST");
  assert.equal(created?.url, "https://api.example.com/v2/projects/9/applications");
  assert.deepEqual(JSON.parse(created?.body ?? "{}"), { name: "Acme App", platform: "ios" });
  assert.deepEqual(said(calls, "spinner.stop"), ["Created `Acme App`"]);
  assert.deepEqual(lockApps(target), { ios: "77" });
  assert.deepEqual(said(calls, "success"), [
    "Pushes go to `Acme App` — saved in superwall.lock, so commit that file.",
  ]);
});

test("an account with no apps creates one interactively, in the project picked", async () => {
  const log = signIn([
    { match: "/v2/projects/10/applications", body: { id: 88 } },
    projects({ id: 9, name: "First", applications: [] }, { id: 10, applications: [] }),
  ]);
  const target = scratch("first-app");
  const calls: RendererCall[] = [];

  await connectApp(
    answeringRenderer({ select: ["10", "android"], text: ["Droid"] }, calls),
    true,
    target,
    target,
    undefined,
    undefined,
  );

  const project = calls.find((call) => call.method === "select")?.value as {
    message: string;
    options: Array<{ value: string; label: string }>;
  };
  assert.equal(project.message, "Which project does the app belong to?");
  assert.deepEqual(project.options, [
    { value: "9", label: "First" },
    { value: "10", label: "10" },
  ]);
  assert.equal(
    log.find((entry) => entry.method === "POST")?.url,
    "https://api.example.com/v2/projects/10/applications",
  );
  assert.deepEqual(lockApps(target), { android: "88" });
});

test("an app the API creates without an id is not bound", async () => {
  signIn([
    { match: "/v2/projects/9/applications", body: { name: "Ghost" } },
    projects({ id: 9, applications: [] }),
  ]);
  const target = scratch("no-id");
  const calls: RendererCall[] = [];

  await connectApp(
    answeringRenderer({ select: ["ios"], text: ["Ghost"] }, calls),
    true,
    target,
    target,
    undefined,
    undefined,
  );
  assert.deepEqual(said(calls, "spinner.stop"), ["Created `Ghost`"]);
  assert.equal(lockApps(target), undefined);
  assert.deepEqual(said(calls, "success"), []);
});

test("creating an app stops at any unanswered question, without calling the API", async () => {
  const twoProjects = projects({ id: 9, applications: [] }, { id: 10, applications: [] });
  for (const answers of [
    { select: [null] },
    { select: ["9"], text: [null] },
    { select: ["9", null], text: ["Named"] },
  ]) {
    const log = signIn([twoProjects]);
    const target = scratch("cancel-create");
    await connectApp(answeringRenderer(answers), true, target, target, undefined, undefined);
    assert.equal(
      log.some((entry) => entry.method === "POST"),
      false,
    );
    assert.equal(lockApps(target), undefined);
  }
});

test("an account with no projects is sent to the dashboard first", async () => {
  signIn([projects()]);
  const target = scratch("no-projects");
  const calls: RendererCall[] = [];

  await connectApp(answeringRenderer({}, calls), true, target, target, undefined, undefined);
  assert.deepEqual(said(calls, "warn"), [
    "Your account has no projects yet — create one in the dashboard first.",
  ]);
  assert.equal(lockApps(target), undefined);
});

test("an account with no apps and nobody to ask leaves setup to the first push", async () => {
  signIn([projects({ id: 9, applications: [] })]);
  const target = scratch("no-apps");
  const calls: RendererCall[] = [];

  await connectApp(recordingRenderer(calls), false, target, target, undefined, undefined);
  assert.deepEqual(said(calls, "info"), [
    "Your account has no apps yet — the first `superwall push` will set one up.",
  ]);
  assert.equal(lockApps(target), undefined);
});

test("a surface id is the slug, numbered past the ones already taken", () => {
  const dir = scratch("surfaces");
  assert.equal(uniqueSurfaceId(dir, "pro"), "pro");
  fs.mkdirSync(path.join(dir, "paywalls", "pro"), { recursive: true });
  fs.mkdirSync(path.join(dir, "paywalls", "pro-2"), { recursive: true });
  assert.equal(uniqueSurfaceId(dir, "pro"), "pro-3");
});
