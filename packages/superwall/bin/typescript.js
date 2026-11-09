import * as fs from "node:fs";
import * as path from "node:path";

const dependsOnSuperwall = (dir) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return Boolean(pkg.dependencies?.superwall ?? pkg.devDependencies?.superwall);
  } catch {
    return false;
  }
};

/**
 * Registers tsx so the CLI can load TypeScript: the framework's own source and a project's
 * `config.ts`. tsx reads the project's `tsconfig.json` (its `jsx` and `paths`) when there is one,
 * and throws at once on a file it cannot read, such as one whose `extends` names a package that
 * isn't installed: a monorepo root's `"extends": "expo/tsconfig.base"` before `npm install`.
 * That file belongs to the user's toolchain, not the CLI's, so it never stops a command: tsx is
 * registered without it, and a superwall project is told its tsconfig was skipped.
 */
export function registerTypeScript(
  projectDir,
  register,
  warn = (line) => process.stderr.write(`${line}\n`),
) {
  const tsconfig = path.join(projectDir, "tsconfig.json");
  if (!fs.existsSync(tsconfig)) return register({ tsconfig: false });
  try {
    return register({ tsconfig });
  } catch (error) {
    if (dependsOnSuperwall(projectDir)) {
      const reason = error instanceof Error ? error.message : String(error);
      warn(`superwall: ignoring ${tsconfig}, which can't be read (${reason}).`);
    }
    return register({ tsconfig: false });
  }
}
