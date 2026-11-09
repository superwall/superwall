// @vitest-environment node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const tsxApi = pathToFileURL(
  path.join(path.dirname(require.resolve("tsx/package.json")), "dist/esm/api/index.mjs"),
).href;
const registerModule = pathToFileURL(
  fileURLToPath(new URL("../../bin/typescript.js", import.meta.url)),
).href;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const project = (files: Record<string, string>): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sw-bin-tsconfig-")));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
};

// What bin/superwall.js does before it loads the CLI, then a TypeScript import, in a fresh Node.
const run = (dir: string) =>
  spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { register } from ${JSON.stringify(tsxApi)};
       import { registerTypeScript } from ${JSON.stringify(registerModule)};
       registerTypeScript(process.cwd(), register);
       const { value } = await import(${JSON.stringify(pathToFileURL(path.join(dir, "main.ts")).href)});
       console.log(value);`,
    ],
    { cwd: dir, encoding: "utf8" },
  );

const MAIN = 'type Value = string;\nexport const value: Value = "loaded";\n';
const BROKEN = JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true } });

test("a tsconfig.json that extends an uninstalled package does not stop the CLI", () => {
  const dir = project({
    "tsconfig.json": BROKEN,
    "package.json": '{"name":"monorepo"}',
    "main.ts": MAIN,
  });

  const result = run(dir);

  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).toBe("loaded");
  expect(result.status).toBe(0);
});

test("a superwall project is told its unreadable tsconfig.json was skipped", () => {
  const dir = project({
    "tsconfig.json": BROKEN,
    "package.json": JSON.stringify({
      name: "app-superwall",
      dependencies: { superwall: "latest" },
    }),
    "main.ts": MAIN,
  });

  const result = run(dir);

  expect(result.stdout.trim()).toBe("loaded");
  expect(result.stderr).toContain(
    `superwall: ignoring ${path.join(dir, "tsconfig.json")}, which can't be read`,
  );
  expect(result.stderr).toContain("expo/tsconfig.base");
});

test("a readable tsconfig.json is still used, so its paths resolve", () => {
  const dir = project({
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }),
    "package.json": JSON.stringify({ type: "module" }),
    "lib/value.ts": 'export const value: string = "aliased";\n',
    "main.ts": 'export { value } from "@/lib/value";\n',
  });

  const result = run(dir);

  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).toBe("aliased");
});

test("without a tsconfig.json tsx is registered without one", () => {
  const dir = project({ "main.ts": MAIN });

  expect(run(dir).stdout.trim()).toBe("loaded");
});
