import * as fs from "node:fs";
import * as path from "node:path";

const REACT_VERSION = "19.1.0";

export function projectPackageName(root: string): string {
  const name = path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return name === "" || name === "superwall" ? "superwall-project" : name;
}

function packageJson(name: string, frameworkVersion: string): string {
  return `${JSON.stringify(
    {
      name,
      private: true,
      type: "module",
      scripts: {
        dev: "superwall dev",
        push: "superwall push",
        promote: "superwall promote",
        ship: "superwall publish",
      },
      dependencies: {
        react: REACT_VERSION,
        "react-dom": REACT_VERSION,
        superwall: frameworkVersion === "unknown" ? "*" : `^${frameworkVersion}`,
      },
    },
    null,
    2,
  )}\n`;
}

const GITIGNORE = `node_modules/
.superwall
.env
`;

function writeIfAbsent(file: string, content: string): void {
  if (fs.existsSync(file)) return;
  try {
    fs.writeFileSync(file, content, { flag: "wx" });
  } catch {
    return;
  }
}

export function writeProjectScaffold(options: {
  root: string;
  superwallDir: string;
  frameworkVersion: string;
}): void {
  writeIfAbsent(
    path.join(options.superwallDir, "package.json"),
    packageJson(projectPackageName(options.root), options.frameworkVersion),
  );
  writeIfAbsent(path.join(options.superwallDir, ".gitignore"), GITIGNORE);
}
