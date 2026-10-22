import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { PaywallMigration } from "@/core/paywalls/migration";
import { runCreate } from "@/core/paywalls/project/create";
import type { CommandContext } from "@/program/command";
import { createCommandOutput } from "@/program/output";
import type { Renderer } from "@/ui";
import { restoreBin, useBin } from "../../../helpers/bin";
import { restoreFetch, useFetch, type Route } from "../../../helpers/fetch";
import { clearHomes, useHome } from "../../../helpers/home";
import { answeringRenderer, said, type Answers } from "../../../helpers/answers";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";
import { exampleTarball } from "../../../helpers/tarball";

const originalAgent = process.env.npm_config_user_agent;
const originalKey = process.env.SUPERWALL_API_KEY;
const originalHost = process.env.SUPERWALL_API_HOST;
let log = "";
const tar = (process.env.PATH ?? "")
  .split(path.delimiter)
  .map((dir) => path.join(dir, "tar"))
  .find((file) => fs.existsSync(file));

beforeEach(() => {
  delete process.env.npm_config_user_agent;
  delete process.env.SUPERWALL_API_KEY;
  delete process.env.SUPERWALL_API_HOST;
  useHome();
  log = path.join(scratch("log"), "ran.log");
  const record = `echo "\${0##*/} $* @ $(pwd -P)" >> "${log}"`;
  process.env.PATH = useBin({
    bun: record,
    git: `${record}\ncase "$1" in rev-parse) exit 128 ;; esac`,
    tar: `exec "${tar}" "$@"`,
  });
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

function appRoot(name: string): string {
  const root = path.join(scratch(name), "my-app");
  fs.mkdirSync(root);
  return root;
}

function context(ui: Renderer, interactive: boolean): CommandContext<"none"> {
  return {
    ui,
    interactive,
    output: createCommandOutput("text", ui),
    outputMode: "text",
    installDir: process.cwd(),
    json: false,
    dryRun: false,
    target: {},
    fail: () => {
      process.exitCode = 1;
    },
  };
}

interface Created {
  calls: RendererCall[];
  studio: string[];
}

function studioRuntime(
  studio: string[],
  choice: "agent" | "copy" | "later" = "later",
  open = false,
): Parameters<typeof runCreate>[2] {
  return {
    offerMigration: async (_ui, _interactive, migration: PaywallMigration) => {
      studio.push(`offer ${migration.surfaceId}`);
      return choice;
    },
    askStudio: async (_ui, _interactive, surfaceId) => {
      studio.push(`ask ${surfaceId}`);
      return open;
    },
    startStudio: async (superwallDir, surfaceId) => {
      studio.push(`start ${superwallDir} ${surfaceId}`);
    },
  };
}

async function create(
  options: Partial<Parameters<typeof runCreate>[1]>,
  setup: { interactive?: boolean; answers?: Answers; choice?: "agent" | "copy" | "later"; open?: boolean } = {},
): Promise<Created> {
  const calls: RendererCall[] = [];
  const studio: string[] = [];
  const ui = setup.answers === undefined ? recordingRenderer(calls) : answeringRenderer(setup.answers, calls);
  await runCreate(
    context(ui, setup.interactive ?? false),
    { yes: false, install: true, connect: false, ...options },
    studioRuntime(studio, setup.choice, setup.open),
  );
  return { calls, studio };
}

function nextSteps(calls: RendererCall[]): string[] {
  const list = calls.find((call) => call.method === "list")?.value as { items: Array<{ label: string }> };
  return list.items.map((item) => item.label);
}

function ran(): string[] {
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
}

function packageName(root: string): string {
  return (JSON.parse(fs.readFileSync(path.join(root, "superwall", "package.json"), "utf8")) as { name: string }).name;
}

const originRow = {
  id: 255456,
  application_id: "43674",
  project_id: "21525",
  application_platform: "ios",
  name: "Force Update",
  identifier: "force-update-1234-2025-06-01",
  paywall_url: "https://runtime.example/store/document/abc",
  presentation_style: "modal",
  status: "active",
  version: 3,
  headless: false,
  products: [{ store: "app-store", identifier: "com.app.pro.year", reference_name: "primary" }],
  feature_gating: "gated",
};

const originDocument = `<html><body><script id="vike_pageContext" type="application/json">${JSON.stringify({
  document: {
    schema: {},
    store: {
      "paywall:paywall": { typeName: "paywall", presentationStyleV3: { type: "MODAL" } },
      "node:root": { typeName: "node", type: "stack", id: "node:root" },
    },
  },
})}</script></body></html>`;

const forceApp = {
  match: "/v2/projects",
  body: {
    data: [{ id: 21525, name: "P", applications: [{ id: 43674, name: "Force", platform: "ios" }] }],
    has_more: false,
  },
};

function signIn(routes: Route[]): void {
  process.env.SUPERWALL_API_KEY = "sk_test_create";
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch(routes);
}

function serveExamples(names: unknown): void {
  const tarball = exampleTarball("apple-pay");
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("api.github.com")) {
      if (names instanceof Error) throw names;
      return Response.json(names);
    }
    if (url.includes("codeload.github.com")) return new Response(tarball);
    return new Response("not stubbed", { status: 404 });
  }) as typeof fetch;
}

test("the minimal template lands in superwall/, installed, committed, with the dev command next", async () => {
  const root = appRoot("minimal");
  const { calls, studio } = await create({ dir: root });

  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "pro", "config.ts")));
  assert.equal(packageName(root), "my-app");
  assert.equal(said(calls, "intro").length, 1);
  assert.deepEqual(said(calls, "step"), [
    "Created superwall/ from the minimal template",
    "Initialized a git repository",
    "Next steps",
  ]);
  assert.deepEqual(ran(), [
    `bun --version @ ${fs.realpathSync(process.cwd())}`,
    `bun install @ ${path.join(root, "superwall")}`,
    `git --version @ ${fs.realpathSync(process.cwd())}`,
    `git rev-parse --is-inside-work-tree @ ${root}`,
    `git init --quiet @ ${root}`,
    `git add -A @ ${root}`,
    `git commit --quiet -m New superwall project @ ${root}`,
  ]);
  assert.deepEqual(nextSteps(calls), ["cd superwall && bun dev", "superwall integrate"]);
  assert.deepEqual(studio, []);
});

test("skipping the install puts it in the next step", async () => {
  const root = appRoot("no-install");
  const { calls } = await create({ dir: root, install: false });

  assert.equal(ran().some((line) => line.startsWith("bun install")), false);
  assert.deepEqual(nextSteps(calls)[0], "cd superwall && bun install && bun dev");
});

test("an app that already uses the SDK is told so and not sent to integrate", async () => {
  const root = appRoot("integrated");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { expo: "51.0.0", "expo-superwall": "1.0.0" } }),
  );
  fs.writeFileSync(path.join(root, "App.tsx"), 'Superwall.configure({ apiKey: "pk_abcdef123456" });\n');
  const { calls } = await create({ dir: root, install: false });

  assert.deepEqual(said(calls, "info"), ["The Superwall SDK is already set up in `my-app`."]);
  assert.deepEqual(nextSteps(calls), ["cd superwall && bun install && bun dev"]);
});

test("flags that contradict each other, or a directory already taken, are refused before anything is written", async () => {
  const root = appRoot("refuse");
  await assert.rejects(create({ dir: root, app: "2" }), /`--app` connects the project to that app — drop `--no-connect`\./);
  await assert.rejects(
    create({ dir: root, from: "1", example: "apple-pay", connect: true }),
    /`--from` rebuilds a dashboard paywall as the starter — drop `--example`\./,
  );
  await assert.rejects(
    create({ dir: root, from: "1" }),
    /`--from` connects the project to the paywall's app — drop `--no-connect`\./,
  );
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);

  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "package.json"), "{}");
  await assert.rejects(create({ dir: root }), /isn't a superwall project — move it aside first/);
});

test("interactively, the start can be cancelled before anything is written", async () => {
  const root = appRoot("cancel-start");
  const { calls } = await create({ dir: root }, { interactive: true, answers: { select: [null] } });

  const prompt = calls.find((call) => call.method === "select")?.value as {
    message: string;
    options: Array<{ value: string }>;
    initialValue: string;
  };
  assert.equal(prompt.message, "Start from");
  assert.deepEqual(
    prompt.options.map((option) => option.value),
    ["minimal", "example"],
  );
  assert.equal(prompt.initialValue, "minimal");
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
});

test("interactively, the minimal start asks before connecting, and a no skips it", async () => {
  const root = appRoot("decline-connect");
  const { calls } = await create(
    { dir: root, connect: true, install: false },
    { interactive: true, answers: { select: ["minimal"], confirm: [false] } },
  );

  assert.deepEqual(
    calls.filter((call) => call.method === "confirm").map((call) => call.value),
    [{ message: "Connect your Superwall account now? (Recommended)", initial: true }],
  );
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "pro", "config.ts")));
  assert.equal(fs.existsSync(path.join(root, "superwall", "superwall.lock")), false);
});

test("interactively, an example is picked from the repo's list and named after the app", async () => {
  const root = appRoot("pick-example");
  serveExamples([
    { name: "apple-pay", type: "dir" },
    { name: "README.md", type: "file" },
  ]);
  const { calls } = await create(
    { dir: root, install: false },
    { interactive: true, answers: { select: ["example", "apple-pay"] } },
  );

  const which = calls.filter((call) => call.method === "select")[1]?.value as {
    message: string;
    options: Array<{ value: string; label: string }>;
  };
  assert.equal(which.message, "Which example?");
  assert.deepEqual(which.options, [{ value: "apple-pay", label: "apple-pay" }]);
  assert.deepEqual(said(calls, "spinner.stop"), [
    "1 examples",
    "Created superwall/ from the `apple-pay` example",
  ]);
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "apple-pay", "config.ts")));
  assert.equal(packageName(root), "my-app");
});

test("interactively, cancelling the example choice writes nothing", async () => {
  const root = appRoot("cancel-example");
  serveExamples([{ name: "apple-pay", type: "dir" }]);
  await create({ dir: root }, { interactive: true, answers: { select: ["example", null] } });

  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
});

test("an example list that cannot be fetched falls back to the minimal template", async () => {
  const unlisted = appRoot("list-http");
  serveExamples([]);
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  const http = await create({ dir: unlisted, install: false }, { interactive: true, answers: { select: ["example"] } });
  assert.deepEqual(said(http.calls, "spinner.stop"), ["Could not fetch the example list"]);
  assert.match(said(http.calls, "warn")[0] ?? "", /\(HTTP 503\)\.\nStarting from minimal instead\.$/);
  assert.ok(fs.existsSync(path.join(unlisted, "superwall", "paywalls", "pro", "config.ts")));

  const offline = appRoot("list-offline");
  serveExamples(new TypeError("fetch failed"));
  const down = await create({ dir: offline, install: false }, { interactive: true, answers: { select: ["example"] } });
  assert.deepEqual(said(down.calls, "warn"), ["TypeError: fetch failed\nStarting from minimal instead."]);
  assert.ok(fs.existsSync(path.join(offline, "superwall", "paywalls", "pro", "config.ts")));
});

test("a failed example download leaves no half-written superwall/ behind", async () => {
  const root = appRoot("download-fail");
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;

  await assert.rejects(create({ dir: root, example: "ghost" }), /Could not download/);
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
});

test("not being signed in never fails the scaffold", async () => {
  const root = appRoot("anon");
  const { calls } = await create({ dir: root, connect: true, install: false });

  assert.deepEqual(said(calls, "info"), ["Not signed in — the first `superwall push` will connect you."]);
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "pro", "config.ts")));
});

test("a connection the API refuses is skipped with the reason, unless an app was named", async () => {
  const root = appRoot("offline");
  signIn([{ match: "/v2/projects", fail: true }]);
  const { calls } = await create({ dir: root, connect: true, install: false });
  assert.match(said(calls, "warn")[0] ?? "", /^Couldn't reach the Superwall API[\s\S]*\nSkipping — the first `superwall push` connects you\.$/);

  await assert.rejects(
    create({ dir: appRoot("offline-app"), connect: true, install: false, app: "2" }),
    /Couldn't reach the Superwall API/,
  );
});

test("a named app is bound without asking", async () => {
  const root = appRoot("named");
  signIn([forceApp]);
  const { calls } = await create(
    { dir: root, connect: true, install: false, app: "43674" },
    { interactive: true, answers: { select: ["minimal"] } },
  );

  assert.deepEqual(said(calls, "confirm"), []);
  assert.equal(said(calls, "select").length, 1);
  assert.match(said(calls, "success")[0] ?? "", /^Pushes go to `Force`/);
});

test("--from rebuilds the paywall, binds its app, and opens the studio after the agent rebuilds it", async () => {
  const root = appRoot("from-agent");
  signIn([
    { match: "/v2/paywalls/255456", body: originRow },
    { match: "runtime.example/store/document/abc", text: originDocument },
    forceApp,
  ]);
  const { calls, studio } = await create(
    { dir: root, from: "255456", connect: true, install: false },
    { interactive: true, answers: {}, choice: "agent", open: true },
  );

  const target = path.join(root, "superwall");
  assert.deepEqual(studio, ["offer force-update", "ask force-update", `start ${target} force-update`]);
  assert.deepEqual(said(calls, "confirm"), []);
  const steps = nextSteps(calls);
  assert.match(steps[0] ?? "", /^The studio opens on the rebuilt paywall/);
  assert.equal(steps.includes("superwall integrate"), true);
  assert.equal(steps.some((step) => step.startsWith("superwall migrate")), false);
});

test("--from without opening the studio, or with a copied prompt, leaves the studio closed", async () => {
  for (const [choice, open, expected] of [
    ["agent", false, ["offer force-update", "ask force-update"]],
    ["copy", true, ["offer force-update"]],
  ] as const) {
    const root = appRoot(`from-${choice}`);
    signIn([
      { match: "/v2/paywalls/255456", body: originRow },
      { match: "runtime.example/store/document/abc", text: originDocument },
      forceApp,
    ]);
    const { calls, studio } = await create(
      { dir: root, from: "255456", connect: true, install: false },
      { interactive: true, answers: {}, choice, open },
    );
    assert.deepEqual(studio, expected);
    assert.match(nextSteps(calls)[0] ?? "", /^Run `superwall dev` in superwall/);
  }
});

test("--from with --yes never offers the rebuild", async () => {
  const root = appRoot("from-yes");
  signIn([
    { match: "/v2/paywalls/255456", body: originRow },
    { match: "runtime.example/store/document/abc", text: originDocument },
    forceApp,
  ]);
  const { calls, studio } = await create(
    { dir: root, from: "255456", connect: true, install: false, yes: true },
    { interactive: true, answers: {}, choice: "agent", open: true },
  );

  assert.deepEqual(studio, []);
  assert.match(nextSteps(calls)[0] ?? "", /^superwall migrate 255456/);
});

test("--from a paywall whose app has no platform connects through that app id", async () => {
  const root = appRoot("from-unbound");
  signIn([
    { match: "/v2/paywalls/255456", body: { ...originRow, application_platform: null, paywall_url: null } },
    forceApp,
  ]);
  const { calls, studio } = await create(
    { dir: root, from: "255456", connect: true, install: false },
    { interactive: true, answers: {} },
  );

  assert.deepEqual(studio, []);
  const lock = JSON.parse(fs.readFileSync(path.join(root, "superwall", "superwall.lock"), "utf8")) as {
    apps: Record<string, string>;
  };
  assert.deepEqual(lock.apps, { ios: "43674" });
  assert.deepEqual(said(calls, "success"), [
    "Pushes go to `Force` — saved in superwall.lock, so commit that file.",
  ]);
});

function existingProject(name: string): string {
  const root = scratch(name);
  fs.mkdirSync(path.join(root, "superwall", "paywalls", "pro"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "superwall", "package.json"),
    JSON.stringify({ name: "mine", dependencies: { superwall: "latest" } }),
  );
  return root;
}

test("inside a project, an example or an app is refused with the reason", async () => {
  const root = existingProject("add-refuse");
  await assert.rejects(create({ dir: root, example: "apple-pay" }), /an example is a whole project, so start it in an empty directory\./);
  await assert.rejects(create({ dir: root, app: "2" }), /is already connected — its apps live in superwall\.lock; drop `--app`\./);
});

test("inside a project, the new paywall is named interactively and gets its own id", async () => {
  const root = existingProject("add-named");
  const { calls } = await create({ dir: root }, { interactive: true, answers: { text: ["  Hero Offer "] } });

  const question = calls.find((call) => call.method === "text")?.value as {
    message: string;
    initialValue: string;
    validate: (value: string) => string | undefined;
  };
  assert.equal(question.message, "What is the paywall called?");
  assert.equal(question.initialValue, "Pro");
  assert.equal(question.validate(" "), "Give the paywall a name.");
  assert.equal(question.validate("Hero"), undefined);
  const config = fs.readFileSync(path.join(root, "superwall", "paywalls", "hero-offer", "config.ts"), "utf8");
  assert.match(config, /name: "Hero Offer"/);
  assert.match(said(calls, "step")[0] ?? "", /paywalls\/hero-offer from the minimal template$/);
  assert.deepEqual(nextSteps(calls), ["paywalls/hero-offer/config.ts", "superwall dev"]);
  assert.equal(ran().length, 0);
});

test("inside a project, cancelling the name adds nothing", async () => {
  const root = existingProject("add-cancel");
  await create({ dir: root }, { interactive: true, answers: { text: [null] } });

  assert.deepEqual(fs.readdirSync(path.join(root, "superwall", "paywalls")), ["pro"]);
});

test("inside a project, the default name is numbered past the paywalls already there", async () => {
  const root = existingProject("add-default");
  await create({ dir: root });

  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "pro-2", "config.ts")));
});

test("run from the root of a bare project, the paywall lands beside its config", async () => {
  const root = scratch("bare");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "mine", dependencies: { superwall: "latest" } }),
  );
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const { calls } = await create({});
    assert.deepEqual(said(calls, "step").slice(0, 1), ["Created ./paywalls/pro from the minimal template"]);
  } finally {
    process.chdir(cwd);
  }
  assert.ok(fs.existsSync(path.join(root, "paywalls", "pro", "config.ts")));
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
});

test("inside a project, --from adds the rebuilt paywall and can open the studio on it", async () => {
  const root = existingProject("add-from");
  signIn([
    { match: "/v2/paywalls/255456", body: originRow },
    { match: "runtime.example/store/document/abc", text: originDocument },
    forceApp,
  ]);
  const opened = await create(
    { dir: root, from: "255456" },
    { interactive: true, answers: {}, choice: "agent", open: true },
  );
  const project = path.join(root, "superwall");
  assert.deepEqual(opened.studio, ["offer force-update", "ask force-update", `start ${project} force-update`]);
  assert.match(nextSteps(opened.calls)[0] ?? "", /^The studio opens/);
  assert.ok(fs.existsSync(path.join(project, "paywalls", "force-update", "MIGRATION.md")));
});

test("inside a project, --from with nobody to ask leaves the rebuild for later", async () => {
  const root = existingProject("add-from-later");
  signIn([
    { match: "/v2/paywalls/255456", body: originRow },
    { match: "runtime.example/store/document/abc", text: originDocument },
    forceApp,
  ]);
  const { calls, studio } = await create({ dir: root, from: "255456" });

  assert.deepEqual(studio, []);
  assert.match(nextSteps(calls)[0] ?? "", /^superwall migrate 255456/);
});
