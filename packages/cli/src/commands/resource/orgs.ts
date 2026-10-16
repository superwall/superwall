import pc from "picocolors";
import { writeJson } from "@/output";

const RETIRED =
  "Organizations are gone from the CLI: `superwall apps list` shows every app you can open, grouped by organization, and commands take --app <id|dashboard link>.";

// Kept hidden so scripts that still run `orgs use` warn instead of failing.
export function runOrgs(): void {
  if (process.argv.includes("--json")) {
    writeJson(process.stdout, { retired: true, message: RETIRED });
    return;
  }
  process.stderr.write(`${pc.yellow("!")} ${RETIRED}\n`);
}
