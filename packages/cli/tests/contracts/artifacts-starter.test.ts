import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { STARTER_DIR } from "@/core/artifacts/sdk";
import { MANIFEST_FILE, VENDORED_SDK } from "@/core/artifacts/project";
import { releaseRefs } from "@/core/repo/download";
import { VERSION } from "@/environment";

// `superwall artifacts create` and `artifacts update` download STARTER_DIR from
// the `v<version>` tag the release workflow cuts from this tree. So the
// directory the CLI names has to exist here, with what create and update read,
// or the release ships a CLI whose starter download fails (as 2.5.1's did once
// main renamed workspaces/starter to artifacts/starter).
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

test("the starter directory the CLI downloads exists in this tree, with what create and update read", () => {
  const starter = path.join(REPO_ROOT, STARTER_DIR);
  for (const file of ["package.json", "package-lock.json", MANIFEST_FILE, "wrangler.jsonc", `${VENDORED_SDK}/package.json`]) {
    assert.ok(fs.existsSync(path.join(starter, file)), `${STARTER_DIR}/${file} is missing`);
  }
});

test("a released CLI reads the starter at its own tag first", () => {
  assert.deepEqual(releaseRefs()[0], { kind: "tag", name: `v${VERSION}` });
});
