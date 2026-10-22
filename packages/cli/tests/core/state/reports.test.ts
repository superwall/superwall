import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { readReport, writeReport } from "@/core/state/reports";

const dirs: string[] = [];

function useAppDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-reports-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("a report is written under .superwall and read back by id", () => {
  const app = useAppDir();

  writeReport(app, "review", "# Findings\n");

  assert.equal(fs.readFileSync(path.join(app, ".superwall", "review.md"), "utf8"), "# Findings\n");
  assert.equal(readReport(app, "review"), "# Findings\n");
});

test("a report that was never written reads as undefined", () => {
  const app = useAppDir();

  assert.equal(readReport(app, "review"), undefined);
});

test("a report that can't be written is skipped without failing", () => {
  const app = useAppDir();
  fs.writeFileSync(path.join(app, ".superwall"), "a file, not a directory");

  assert.doesNotThrow(() => writeReport(app, "review", "text"));
  assert.equal(readReport(app, "review"), undefined);
});

test("a report path that can't be read reads as undefined", () => {
  const app = useAppDir();
  fs.mkdirSync(path.join(app, ".superwall", "review.md"), { recursive: true });

  assert.equal(readReport(app, "review"), undefined);
});
