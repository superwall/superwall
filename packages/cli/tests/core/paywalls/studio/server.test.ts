import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { FrameworkProject, FrameworkSurface } from "@/core/paywalls/project/framework";
import { runStudio } from "@/core/paywalls/studio/server";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { writeFakeFrameworkProject } from "../../../helpers/framework";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

const FAKE = {
  discover: "export const discoverProject = (root) => globalThis.__studio.discover(root);\n",
  preview:
    "export const startPreviewServer = async (roots, options) => globalThis.__studio.start(roots, options);\n",
};

interface Started {
  roots: string[];
  options: { port: number; host?: string; platformStylesheet?: string; studio?: unknown };
}

interface Studio {
  projects: Map<string, Partial<FrameworkProject>>;
  urls: { local: string[]; network: string[] } | null;
  started: Started[];
}

const dirs: string[] = [];
const savedEnv = { ...process.env };
const savedCwd = process.cwd();

afterEach(() => {
  process.chdir(savedCwd);
  process.env = { ...savedEnv };
  selectRenderer({ mode: "text" });
  Reflect.deleteProperty(globalThis, "__studio");
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const surfaceOf = (kind: "paywall" | "funnel", id: string): FrameworkSurface => ({
  kind,
  id,
  dir: `/tmp/${id}`,
  configFile: `/tmp/${id}/config.ts`,
  routes: [],
});

function studio(urls: Studio["urls"] = { local: ["http://localhost:6100/"], network: [] }): Studio {
  const state: Studio = { projects: new Map(), urls, started: [] };
  Reflect.set(globalThis, "__studio", {
    discover: (root: string): FrameworkProject => ({
      root,
      superwallDir: path.join(root, "superwall"),
      surfaces: [],
      diagnostics: [],
      ...state.projects.get(root),
    }),
    start: async (roots: string[], options: Started["options"]) => {
      state.started.push({ roots, options });
      return { resolvedUrls: state.urls };
    },
  });
  return state;
}

function project(state: Studio, shape: Partial<FrameworkProject> = {}): string {
  const root = writeFakeFrameworkProject(FAKE);
  dirs.push(root);
  fs.mkdirSync(path.join(root, "superwall"));
  state.projects.set(root, { marker: "package.json", ...shape });
  return root;
}

function blockingPlist(root: string): string {
  const plist = path.join(root, "ios", "Info.plist");
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, "<plist><dict><key>CFBundleIdentifier</key><string>com.acme</string></dict></plist>");
  return plist;
}

function recording(confirm: boolean | null = null): RendererCall[] {
  const calls: RendererCall[] = [];
  useRenderer({
    ...recordingRenderer(calls),
    confirm: async (options) => {
      calls.push({ method: "confirm", value: options });
      return confirm;
    },
  });
  return calls;
}

const said = (calls: RendererCall[], method: string): string[] =>
  calls.filter((call) => call.method === method).map((call) => stripVTControlCharacters(String(call.value)));

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the studio serves the project, writes its types and scaffold, and lists every surface's URL", async () => {
  const state = studio({ local: ["http://localhost:6101/"], network: [] });
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro"), surfaceOf("funnel", "welcome")] });
  process.env.SUPERWALL_RUNTIME_URL = "https://runtime.test//";
  const calls = recording();

  await runStudio({ dirs: [root], port: 6100, host: "127.0.0.1", interactive: false });

  assert.equal(state.started.length, 1);
  assert.deepEqual(state.started[0]?.roots, [root]);
  assert.equal(state.started[0]?.options.port, 6100);
  assert.equal(state.started[0]?.options.host, "127.0.0.1");
  assert.equal(state.started[0]?.options.platformStylesheet, "https://runtime.test/live.css");
  assert.equal(typeof state.started[0]?.options.studio, "object");
  assert.ok(fs.existsSync(path.join(root, "superwall", "superwall.d.ts")));
  assert.ok(fs.existsSync(path.join(root, "superwall", "package.json")));
  assert.match(said(calls, "intro")[0] ?? "", /^Superwall v/);
  assert.deepEqual(said(calls, "warn"), ["Port 6100 was in use — moved to 6101."]);
  assert.deepEqual(said(calls, "step"), [
    [
      "Studio http://localhost:6101/",
      "paywall/pro  http://localhost:6101/paywall/pro",
      "funnel/welcome  http://localhost:6101/funnel/welcome",
    ].join("\n"),
  ]);
});

test("a server that reports no URLs is assumed to be on the port asked for, with no stylesheet override", async () => {
  const state = studio(null);
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const calls = recording();

  await runStudio({ dirs: [root], port: 6200, host: "0.0.0.0", interactive: false });

  assert.equal(state.started[0]?.options.platformStylesheet, undefined);
  assert.deepEqual(said(calls, "warn"), []);
  assert.match(said(calls, "step")[0] ?? "", /^Studio http:\/\/localhost:6200\/\npaywall\/pro {2}http:\/\/localhost:6200\/paywall\/pro$/);
});

test("--open opens the browser on that studio path, and says so when no browser can open", async () => {
  const state = studio();
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const opened: string[] = [];
  const calls = recording();

  await runStudio(
    { dirs: [root], port: 6100, host: "0.0.0.0", open: "/paywall/pro?compare=origin", interactive: false },
    { openBrowser: async (url) => (opened.push(url), false) },
  );
  await settle();

  assert.deepEqual(opened, ["http://localhost:6100/paywall/pro?compare=origin"]);
  assert.deepEqual(said(calls, "warn"), [
    "Couldn't open a browser here. Open http://localhost:6100/paywall/pro?compare=origin yourself.",
  ]);
});

test("a browser that opens leaves nothing to say, and an empty --open opens nothing", async () => {
  const state = studio();
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const opened: string[] = [];
  const calls = recording();
  const openBrowser = async (url: string) => (opened.push(url), true);

  await runStudio({ dirs: [root], port: 6100, host: "0.0.0.0", open: "paywall/pro", interactive: false }, { openBrowser });
  await runStudio({ dirs: [root], port: 6100, host: "0.0.0.0", open: "", interactive: false }, { openBrowser });
  await settle();

  assert.deepEqual(opened, ["http://localhost:6100/paywall/pro"]);
  assert.deepEqual(said(calls, "warn"), []);
});

test("a network URL adds a device step with a QR code for the phone", async () => {
  const state = studio({ local: ["http://localhost:6100/"], network: ["http://192.168.1.20:6100/"] });
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const calls = recording();

  await runStudio({ dirs: [root], port: 6100, host: "0.0.0.0", interactive: false });

  const device = said(calls, "step")[1] ?? "";
  assert.match(device, /^Device http:\/\/192\.168\.1\.20:6100\/device\n/);
  assert.match(device, /Scan on a phone on the same wifi to preview on device:/);
  assert.ok(device.split("\n").length > 10, "the QR code is drawn below the URL");
});

test("an app whose Info.plist blocks plain http is told what to add when nobody can answer", async () => {
  const state = studio();
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const plist = blockingPlist(root);
  const calls = recording(true);
  const allowed: string[] = [];

  await runStudio(
    { dirs: [root], port: 6100, host: "0.0.0.0", interactive: false },
    { allowLocalNetworking: async (file) => void allowed.push(file) },
  );

  assert.deepEqual(allowed, []);
  assert.equal(calls.some((call) => call.method === "confirm"), false);
  assert.deepEqual(said(calls, "warn"), [
    "This app can't load paywalls from the dev server: App Transport Security blocks plain http.",
    `Add to ${plist}, in your Debug configuration only:\n` +
      "  NSAppTransportSecurity → NSAllowsLocalNetworking = YES\n" +
      "                         → NSAllowsArbitraryLoadsInWebContent = YES",
  ]);
});

test("allowing local previewing edits the Info.plist and asks for a rebuild", async () => {
  const state = studio();
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const plist = blockingPlist(root);
  const calls = recording(true);
  const allowed: string[] = [];

  await runStudio(
    { dirs: [root], port: 6100, host: "0.0.0.0", interactive: true },
    { allowLocalNetworking: async (file) => void allowed.push(file) },
  );

  assert.deepEqual(allowed, [plist]);
  const confirm = calls.find((call) => call.method === "confirm")?.value;
  assert.deepEqual(confirm, {
    message: "Allow local previewing in Info.plist? Development builds only.",
    initial: true,
  });
  assert.ok(said(calls, "step").includes(`Local previewing allowed in ${plist} — rebuild the app to pick it up.`));
});

test("an Info.plist that cannot be edited is reported with the reason", async () => {
  const state = studio();
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const plist = blockingPlist(root);
  const calls = recording(true);

  await runStudio(
    { dirs: [root], port: 6100, host: "0.0.0.0", interactive: true },
    {
      allowLocalNetworking: async () => {
        throw new Error("Editing an Info.plist needs `plutil`, which ships with macOS.");
      },
    },
  );
  await runStudio(
    { dirs: [root], port: 6100, host: "0.0.0.0", interactive: true },
    {
      allowLocalNetworking: () => Promise.reject("plutil exited 1"),
    },
  );

  const warnings = said(calls, "warn");
  assert.ok(warnings.includes(`Could not edit ${plist}: Editing an Info.plist needs \`plutil\`, which ships with macOS.`));
  assert.ok(warnings.includes(`Could not edit ${plist}: plutil exited 1`));
});

test("declining the edit prints the keys to add by hand", async () => {
  const state = studio();
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const plist = blockingPlist(root);
  const calls = recording(false);
  const allowed: string[] = [];

  await runStudio(
    { dirs: [root], port: 6100, host: "0.0.0.0", interactive: true },
    { allowLocalNetworking: async (file) => void allowed.push(file) },
  );

  assert.deepEqual(allowed, []);
  assert.match(said(calls, "warn").at(-1) ?? "", new RegExp(`^Add to ${plist.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}, in your Debug configuration only:`));
});

test("project diagnostics are warned, and an empty project says how to lay one out", async () => {
  const state = studio();
  const root = project(state, { diagnostics: ["paywalls/pro/Hero.tsx is a component inside app/."] });
  const calls = recording();

  await runStudio({ dirs: [root], port: 6100, host: "0.0.0.0", interactive: false });

  const warnings = said(calls, "warn");
  assert.equal(warnings[0], "paywalls/pro/Hero.tsx is a component inside app/.");
  assert.match(warnings[1] ?? "", /^Nothing to preview — /);
  assert.equal(said(calls, "step")[0], "Studio http://localhost:6100/");
});

test("several directories share one studio, each project under its own prefix, skipping non-projects", async () => {
  const state = studio();
  const one = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  const two = project(state, { surfaces: [surfaceOf("funnel", "welcome")] });
  const stray = project(state);
  state.projects.set(stray, {});
  const calls = recording();

  await runStudio({ dirs: [one, two, stray], port: 6100, host: "0.0.0.0", interactive: false });

  assert.deepEqual(state.started[0]?.roots, [one, two]);
  assert.equal(fs.existsSync(path.join(stray, "superwall", "superwall.d.ts")), false);
  assert.deepEqual(said(calls, "step"), [
    [
      "Studio http://localhost:6100/",
      path.basename(one),
      `  paywall/pro  http://localhost:6100/${path.basename(one)}/paywall/pro`,
      path.basename(two),
      `  funnel/welcome  http://localhost:6100/${path.basename(two)}/funnel/welcome`,
    ].join("\n"),
  ]);
});

test("several directories with no project among them start nothing", async () => {
  const state = studio();
  const one = project(state);
  const two = project(state);
  state.projects.set(one, {});
  state.projects.set(two, {});
  recording();

  await assert.rejects(
    runStudio({ dirs: [one, two], port: 6100, host: "0.0.0.0", interactive: false }),
    /^Error: No superwall projects found in 2 directories\.\nExpected a package\.json in each/,
  );
  assert.deepEqual(state.started, []);
});

test("a glob that matches nothing falls back to the current directory", async () => {
  const state = studio();
  const root = project(state, { surfaces: [surfaceOf("paywall", "pro")] });
  process.chdir(root);
  recording();

  await assert.rejects(
    runStudio({ dirs: [path.join(root, "nothing-*")], port: 6100, host: "0.0.0.0", interactive: false }),
    /No superwall projects found in 0 directories/,
  );
  assert.deepEqual(state.started, []);
});

test("a single directory that isn't a project is refused by name", async () => {
  const state = studio();
  const root = project(state);
  state.projects.set(root, {});
  recording();

  await assert.rejects(
    runStudio({ dirs: [root], port: 6100, host: "0.0.0.0", interactive: false }),
    new RegExp(`Not a superwall project: ${root}`),
  );
  assert.deepEqual(state.started, []);
});
