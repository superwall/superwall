import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { main } from "@/entry";
import { VERSION } from "@/environment";

const argv = process.argv;

afterEach(() => {
  process.argv = argv;
  mock.restoreAll();
});

test("main runs the program", async () => {
  process.argv = ["node", "superwall", "--version"];
  let stdout = "";
  mock.method(process.stdout, "write", (value: unknown) => {
    stdout += String(value);
    return true;
  });
  await main();
  mock.restoreAll();
  assert.equal(stdout, `${VERSION}\n`);
});
