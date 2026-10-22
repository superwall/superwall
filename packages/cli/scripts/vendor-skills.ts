import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { CHANNELS, type Channel } from "../src/environment";
import { SUPERWALL_SKILLS_SOURCE, skillSummary, type BundledSkill } from "../src/core/support/skills";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist", "skills");
const args = process.argv.slice(2);
const fromIndex = args.indexOf("--from");
const fromArg = fromIndex === -1 ? process.env.SUPERWALL_SKILLS_DIR : args[fromIndex + 1];
const from = fromArg ? path.resolve(fromArg) : undefined;
const refOverride = process.env.SUPERWALL_SKILLS_REF;

function checkout(ref: string): string {
  if (from) return from;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-skills-"));
  const tarball = path.join(scratch, "skills.tar.gz");
  const url = `https://codeload.github.com/${SUPERWALL_SKILLS_SOURCE}/tar.gz/${ref}`;
  execFileSync("curl", ["-sSfL", "--retry", "4", url, "-o", tarball], { stdio: "inherit" });
  execFileSync("tar", ["-xzf", tarball, "-C", scratch], { stdio: "inherit" });
  const extracted = fs.readdirSync(scratch).find((entry) => entry !== "skills.tar.gz");
  if (!extracted) throw new Error(`Nothing extracted from ${url}`);
  return path.join(scratch, extracted);
}

const skillsIn = (source: string): string[] =>
  fs
    .readdirSync(path.join(source, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(source, "skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

const index: BundledSkill[] = [];
const sources: string[] = [];
for (const channel of Object.keys(CHANNELS) as Channel[]) {
  const ref = refOverride ?? CHANNELS[channel].skillsRef;
  const source = checkout(ref);
  const added = skillsIn(source).filter((name) => !index.some((skill) => skill.name === name));
  for (const name of added) {
    const dir = path.join(source, "skills", name);
    fs.cpSync(dir, path.join(target, name), { recursive: true });
    index.push({ name, channel, summary: skillSummary(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")) });
  }
  sources.push(`${added.length} from ${from ?? `${SUPERWALL_SKILLS_SOURCE}@${ref}`} (${channel})`);
}
if (!index.some((skill) => skill.name === "superwall")) throw new Error("The skills repo has no skills/superwall");
fs.writeFileSync(path.join(target, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Bundled ${index.length} skills into dist/skills: ${sources.join(", ")}`);
