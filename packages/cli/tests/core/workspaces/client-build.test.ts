import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleWorkspace, type RunWrangler } from "@/core/workspaces/bundle";
import { clientEntryProblem } from "@/core/workspaces/client-build";
import { fakeWrangler, MANIFEST, withAcceptedConfig, workspaceProject } from "./fixture";

const CLI_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const STARTER_SDK = path.resolve(CLI_ROOT, "../../workspaces/starter/vendor/workspace-sdk");
const WRANGLER = path.dirname(createRequire(path.join(CLI_ROOT, "package.json")).resolve("wrangler/package.json"));

function clientProject(files: Record<string, string>, entry = "src/client.tsx", manifest: object = MANIFEST): string {
  const root = workspaceProject({ ...manifest, client: { entry } });
  fs.mkdirSync(path.join(root, "node_modules/@superwall"), { recursive: true });
  fs.symlinkSync(STARTER_SDK, path.join(root, "node_modules/@superwall/workspace-sdk"));
  fs.symlinkSync(WRANGLER, path.join(root, "node_modules/wrangler"));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

function recording(): { wrangler: RunWrangler; args: () => readonly string[] } {
  const inner = fakeWrangler();
  let seen: readonly string[] = [];
  return {
    wrangler: withAcceptedConfig(async (cwd, args) => {
      seen = args;
      await inner(cwd, args);
    }),
    args: () => seen,
  };
}

test("client.entry is built with the project's SDK and reaches wrangler as an alias", async () => {
  const root = clientProject({
    "src/label.ts": 'export const label = "from TypeScript";\n',
    "src/styles.css": "body { color: rgb(1, 2, 3); }\n",
    "src/client.tsx": 'import { label } from "./label";\nimport "./styles.css";\nconsole.log(label);\n',
  });
  const { wrangler, args } = recording();
  await bundleWorkspace(root, wrangler);

  const at = args().indexOf("--alias");
  assert.ok(at > 0);
  const [specifier, ...rest] = args()[at + 1]!.split(":");
  const file = rest.join(":");
  assert.equal(specifier, "@superwall/workspace-sdk/client-bundle");
  assert.ok(path.isAbsolute(file));
  assert.ok(!args()[at + 1]!.includes("="), "the separator is a colon");
  assert.equal(args()[args().indexOf("--env-file") + 1], os.devNull);
  assert.equal(args()[args().indexOf("--config") + 1], path.join(fs.realpathSync(root), "superwall.json"));

  const { default: bundle } = (await import(pathToFileURL(file).href)) as {
    default: { scriptPath: string; script: string; stylePath: string; style: string };
  };
  assert.match(bundle.scriptPath, /^\/_client\/[0-9a-f]{16}\.js$/);
  assert.match(bundle.stylePath, /^\/_client\/[0-9a-f]{16}\.css$/);
  assert.match(bundle.script, /from TypeScript/);
  assert.match(bundle.style, /color:#010203|rgb\(1, ?2, ?3\)/);
});

test("with no client.entry, wrangler gets no alias and the SDK isn't touched", async () => {
  const root = workspaceProject();
  const { wrangler, args } = recording();
  await bundleWorkspace(root, wrangler);
  assert.ok(!args().includes("--alias"));
});

test("a problem in the source shows file, line and column, and wrangler never runs", async () => {
  const syntax = clientProject({ "src/client.tsx": 'import { label } from "./label";\nconsole.log(label);\n', "src/label.ts": "export const label = (\n" });
  const called = recording();
  await assert.rejects(bundleWorkspace(syntax, called.wrangler), /src\/label\.ts:2:0: Unexpected end of file/);
  assert.deepEqual(called.args(), []);

  const missing = clientProject({ "src/client.tsx": 'import "not-in-the-lockfile";\n' });
  await assert.rejects(
    bundleWorkspace(missing, recording().wrangler),
    /src\/client\.tsx:1:7: Could not resolve "not-in-the-lockfile" \(is it in package\.json and package-lock\.json\?\)/,
  );
});

test("an entry that isn't a file in the repo is refused the way the builder refuses it", async () => {
  const absent = clientProject({}, "src/nope.tsx");
  await assert.rejects(bundleWorkspace(absent, recording().wrangler), /client\.entry: src\/nope\.tsx is not in the repo\./);

  const folder = clientProject({ "src/app.tsx/x": "" }, "src/app.tsx");
  await assert.rejects(bundleWorkspace(folder, recording().wrangler), /client\.entry: src\/app\.tsx is not a file\./);

  const linkedFile = clientProject({}, "src/link.tsx");
  const elsewhere = workspaceProject();
  fs.writeFileSync(path.join(elsewhere, "real.tsx"), "console.log(1)");
  fs.symlinkSync(path.join(elsewhere, "real.tsx"), path.join(linkedFile, "src/link.tsx"));
  await assert.rejects(bundleWorkspace(linkedFile, recording().wrangler), /client\.entry: src\/link\.tsx is not a file\./);

  const linkedDir = clientProject({}, "ui/real.tsx");
  fs.symlinkSync(elsewhere, path.join(linkedDir, "ui"));
  await assert.rejects(bundleWorkspace(linkedDir, recording().wrangler), /client\.entry: ui\/real\.tsx is outside the repo\./);
});

test("browser code can't read a file outside the repo or its git metadata, even through a link", async () => {
  const elsewhere = workspaceProject();
  fs.writeFileSync(path.join(elsewhere, "secret.ts"), 'export const secret = "from outside";');

  const relative = clientProject({});
  fs.mkdirSync(path.join(relative, "..", path.basename(relative) + "-y"));
  fs.writeFileSync(path.join(relative, "..", path.basename(relative) + "-y", "secret.ts"), 'export const secret = "beside";');
  fs.writeFileSync(path.join(relative, "src/client.tsx"), `import { secret } from "../../${path.basename(relative)}-y/secret";\nconsole.log(secret);\n`);
  const direct = recording();
  await assert.rejects(bundleWorkspace(relative, direct.wrangler), /The bundle reads files outside the repo, which isn't allowed: \.\.\/.*secret\.ts\./);
  assert.deepEqual(direct.args(), []);
  fs.rmSync(path.join(relative, "..", path.basename(relative) + "-y"), { recursive: true });

  const linked = clientProject({ "src/client.tsx": 'import { secret } from "./link";\nconsole.log(secret);\n' });
  fs.symlinkSync(path.join(elsewhere, "secret.ts"), path.join(linked, "src/link.ts"));
  await assert.rejects(bundleWorkspace(linked, recording().wrangler), /reads files outside the repo/);

  const git = clientProject({ "src/client.tsx": 'import "../.git/config.js";\n', ".git/config.js": "console.log(1);" });
  await assert.rejects(bundleWorkspace(git, recording().wrangler), /reads files outside the repo, which isn't allowed: \.git\/config\.js\./);
});

test("the entry's shape follows the manifest's rules", () => {
  for (const entry of ["../client.tsx", "/etc/x.ts", "src/client.css", "src//client.ts", "src/./client.ts", 5, undefined, `${"a".repeat(256)}.ts`]) {
    assert.match(clientEntryProblem(entry)!, /client\.entry must/, String(entry));
  }
  assert.match(clientEntryProblem("node_modules/x/index.js")!, /must not be inside node_modules/);
  assert.match(clientEntryProblem("a/../b.ts")!, /must stay inside the repo/);
  for (const entry of ["src/client.tsx", "client.ts", "ui/app/main.mjs", "a.jsx", "b.js", "c.mts"]) {
    assert.equal(clientEntryProblem(entry), undefined, entry);
  }
});

test("a bundle over the limit is refused before wrangler, and names the largest inputs", async () => {
  const root = clientProject({
    "src/big.ts": `export const big = "${"a".repeat(8.2 * 1024 * 1024)}";\n`,
    "src/client.tsx": 'import { big } from "./big";\nconsole.log(big);\n',
  });
  const called = recording();
  await assert.rejects(
    bundleWorkspace(root, called.wrangler),
    /The client bundle is \d+ bytes \(8\.2 MiB\); the limit is 8388608 \(8\.0 MiB\)\. Largest: src\/big\.ts \(8\.2 MiB\)/,
  );
  assert.deepEqual(called.args(), []);
});

test("an SDK too old for client.entry says how to get a newer one", async () => {
  const root = workspaceProject({ ...MANIFEST, client: { entry: "src/client.tsx" } });
  fs.writeFileSync(path.join(root, "src/client.tsx"), "console.log(1)");
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.symlinkSync(WRANGLER, path.join(root, "node_modules/wrangler"));
  await assert.rejects(bundleWorkspace(root, recording().wrangler), /workspace SDK is too old.*superwall workspaces update/);

  fs.mkdirSync(path.join(root, "node_modules/@superwall/workspace-sdk"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "node_modules/@superwall/workspace-sdk/package.json"),
    JSON.stringify({ name: "@superwall/workspace-sdk", version: "0.2.0", exports: { "./client-build": "./a.mjs", "./constants": "./b.mjs" } }),
  );
  fs.writeFileSync(path.join(root, "node_modules/@superwall/workspace-sdk/a.mjs"), "export const buildClient = () => {};");
  fs.writeFileSync(path.join(root, "node_modules/@superwall/workspace-sdk/b.mjs"), "export const CLIENT_BUNDLE_MAX_BYTES = 1;");
  await assert.rejects(bundleWorkspace(root, recording().wrangler), /workspace SDK is too old/, "the early 0.2.0, before the fixes");
});

function withEsbuild(version: string | null): string {
  const root = clientProject({ "src/client.tsx": "console.log(1)" });
  fs.rmSync(path.join(root, "node_modules/wrangler"));
  const wrangler = path.join(root, "node_modules/wrangler");
  fs.mkdirSync(wrangler);
  fs.writeFileSync(path.join(wrangler, "package.json"), JSON.stringify({ name: "wrangler", version: "1.0.0" }));
  if (version !== null) {
    const esbuild = path.join(wrangler, "node_modules/esbuild");
    fs.mkdirSync(esbuild, { recursive: true });
    fs.writeFileSync(path.join(esbuild, "package.json"), JSON.stringify({ name: "esbuild", version, main: "index.js" }));
    fs.writeFileSync(path.join(esbuild, "index.js"), `module.exports = { version: ${JSON.stringify(version)}, build: async () => ({}) };`);
  }
  return root;
}

test("another esbuild than the builder's is refused, and a missing one says to install", async () => {
  const other = withEsbuild("0.24.0");
  await assert.rejects(bundleWorkspace(other, recording().wrangler), /bundled with esbuild 0\.28\.2, not 0\.24\.0.*wrangler the starter pins/);
  const none = withEsbuild(null);
  await assert.rejects(bundleWorkspace(none, recording().wrangler), /esbuild this project's wrangler brings.*npm install/);
});

test("a Worker that imports the bundle without declaring it is told what to declare", async () => {
  const root = workspaceProject();
  const refusing = withAcceptedConfig(async () => {
    throw new Error('The workspace didn\'t bundle:\nCould not resolve "@superwall/workspace-sdk/client-bundle"');
  });
  await assert.rejects(bundleWorkspace(root, refusing), /Could not resolve[\s\S]*Declare the browser entry in superwall\.json: "client"/);
  const other = withAcceptedConfig(async () => {
    throw new Error("Something else");
  });
  await assert.rejects(bundleWorkspace(root, other), /^Error: Something else$/);
  const declared = clientProject({ "src/client.tsx": "console.log(1)" });
  await assert.rejects(bundleWorkspace(declared, refusing), (error: Error) => !/Declare the browser entry/.test(error.message));
});
