import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  adoptExamplePackage,
  downloadExample,
  ExampleError,
  listExamples,
  type FetchLike,
} from "@/core/paywalls/project/examples";

function scratch(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
}

function respond(status: number, body: Buffer | unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () =>
      Buffer.isBuffer(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0),
    json: async () => body,
  });
}

function repoTarball(): Buffer {
  const stage = scratch("tarball");
  const example = path.join(stage, "superwall-main", "examples", "demo");
  fs.mkdirSync(path.join(example, "paywalls", "demo", "app"), { recursive: true });
  fs.writeFileSync(
    path.join(example, "package.json"),
    `${JSON.stringify({ name: "demo", dependencies: { superwall: "workspace:*" } }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(example, "paywalls", "demo", "app", "index.tsx"), "export {};\n");
  const tarball = path.join(stage, "repo.tar.gz");
  execFileSync("tar", ["-czf", tarball, "-C", stage, "superwall-main"]);
  return fs.readFileSync(tarball);
}

test("listExamples returns the repo's example directories, sorted", async () => {
  const names = await listExamples(() =>
    respond(200, [
      { name: "with-rive", type: "dir" },
      { name: "README.md", type: "file" },
      { name: "minimal", type: "dir" },
    ]),
  );

  assert.deepEqual(names, ["minimal", "with-rive"]);
});

test("listExamples skips unnamed entries and reads anything but a list as no examples", async () => {
  const names = await listExamples(() =>
    respond(200, [{ type: "dir" }, { name: "demo", type: "dir" }, null]),
  );
  assert.deepEqual(names, ["demo"]);
  assert.deepEqual(await listExamples(() => respond(200, { message: "moved" })), []);
});

test("listExamples surfaces an HTTP failure as an ExampleError naming the repo", async () => {
  await assert.rejects(
    listExamples(() => respond(404, [])),
    (error: unknown) => error instanceof ExampleError && /github\.com\//.test(error.message),
  );
});

test("downloadExample lands the example at the target root", async () => {
  const tarball = repoTarball();
  const target = path.join(scratch("download"), "demo");
  await downloadExample("demo", target, () => respond(200, tarball));

  assert.ok(fs.existsSync(path.join(target, "package.json")));
  assert.ok(fs.existsSync(path.join(target, "paywalls", "demo", "app", "index.tsx")));
});

test("an example the repo does not have is a clear error, not an empty directory", async () => {
  const tarball = repoTarball();
  const target = path.join(scratch("missing"), "nope");
  await assert.rejects(
    downloadExample("nope", target, () => respond(200, tarball)),
    (error: unknown) => error instanceof ExampleError && error.message.includes("`nope`"),
  );
});

test("a download the repo refuses names the status and leaves nothing behind", async () => {
  const target = path.join(scratch("refused"), "demo");
  await assert.rejects(
    downloadExample("demo", target, () => respond(503, Buffer.alloc(0))),
    (error: unknown) =>
      error instanceof ExampleError &&
      error.message === "Could not download github.com/superwall/superwall (HTTP 503). Check your network, then try again.",
  );
  assert.equal(fs.existsSync(target), false);
});

test("a damaged download is its own error and leaves nothing behind", async () => {
  const target = path.join(scratch("damaged"), "demo");
  await assert.rejects(
    downloadExample("demo", target, () => respond(200, Buffer.from("not gzip"))),
    (error: unknown) =>
      error instanceof ExampleError &&
      error.message === "The download of github.com/superwall/superwall was damaged. Try again.",
  );
  assert.equal(fs.existsSync(target), false);
});

test("an example directory without a package.json is not a project", async () => {
  const stage = scratch("bare-example");
  const example = path.join(stage, "superwall-main", "examples", "bare");
  fs.mkdirSync(example, { recursive: true });
  fs.writeFileSync(path.join(example, "README.md"), "# bare\n");
  const tarball = path.join(stage, "repo.tar.gz");
  execFileSync("tar", ["-czf", tarball, "-C", stage, "superwall-main"]);

  await assert.rejects(
    downloadExample("bare", path.join(scratch("bare-target"), "bare"), () =>
      respond(200, fs.readFileSync(tarball)),
    ),
    (error: unknown) =>
      error instanceof ExampleError && error.message === "Example `bare` did not contain a project.",
  );
});

test("an example name is validated before any network traffic", async () => {
  let fetched = 0;
  const spy: FetchLike = () => {
    fetched += 1;
    return respond(200, []);
  };
  await assert.rejects(downloadExample("../escape", "/tmp/x", spy), ExampleError);
  assert.equal(fetched, 0);
});

test("adoptExamplePackage renames the project and swaps workspace:* for latest", async () => {
  const tarball = repoTarball();
  const target = path.join(scratch("adopt"), "demo");
  await downloadExample("demo", target, () => respond(200, tarball));
  adoptExamplePackage(target, "my-app");

  const parsed = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  assert.equal(parsed.name, "my-app");
  assert.equal(parsed.dependencies.superwall, "latest");
});
