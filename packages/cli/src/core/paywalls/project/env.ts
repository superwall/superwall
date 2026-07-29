import * as fs from "node:fs";
import * as path from "node:path";

export const ENV_TYPES_FILE = "superwall-env.d.ts";

const CONTENT = `/// <reference types="superwall/assets" />
// Commit this file: it is what makes \`import hero from "./assets/hero.jpg"\` typecheck. Managed by the Superwall CLI.
`;

export function writeEnvTypes(superwallDir: string): void {
  const file = path.join(superwallDir, ENV_TYPES_FILE);
  if (fs.existsSync(file)) return;
  try {
    fs.writeFileSync(file, CONTENT, { flag: "wx" });
  } catch {
    return;
  }
}
