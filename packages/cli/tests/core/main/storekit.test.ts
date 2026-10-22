import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command as products } from "@/commands/main/products";
import { generateStoreKit } from "@/core/main/storekit";
import { said } from "../../helpers/answers";
import { runCommand } from "../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { routedApi } from "../../helpers/routed-api";

const cwd = process.cwd();

afterEach(() => {
  process.chdir(cwd);
  process.exitCode = undefined;
});

const PROJECT = { id: "1", name: "Lab", applications: [{ id: "10", platform: "ios" }] };

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sw-storekit-"));
}

async function storekit(flags: Record<string, unknown>, rows: unknown[], json = false) {
  const { api } = routedApi({ "GET /v2/projects": [PROJECT], "GET /v2/products?project_id=1": rows });
  const calls: RendererCall[] = [];
  const result = await runCommand(products, { words: ["storekit"], flags, json, api, renderer: recordingRenderer(calls) });
  return { result, calls };
}

test("a StoreKit file lists each product once, by its store identifier", () => {
  const file = generateStoreKit([
    { id: "p1", identifier: "pro_monthly" },
    { id: "p2", product_identifier: "pro_yearly" },
    { id: "p3", name: "Lifetime" },
    { id: "p4" },
  ]) as { products: Array<{ productID: string; internalID: string; localizations: unknown[] }>; version: unknown };
  assert.deepEqual(file.products.map((product) => product.productID), ["pro_monthly", "pro_yearly", "Lifetime"]);
  assert.deepEqual(file.products.map((product) => product.internalID), ["1000", "1001", "1002"]);
  assert.deepEqual(file.products[0]?.localizations, [{ description: "pro_monthly", displayName: "pro_monthly", locale: "en_US" }]);
  assert.deepEqual(file.version, { major: 3, minor: 0 });
});

test("products storekit --out writes the project's products there and says how many", async () => {
  const out = path.join(scratch(), "Test.storekit");
  const { calls } = await storekit({ out, project: "1" }, [{ id: "p1", identifier: "pro" }]);
  const written = JSON.parse(fs.readFileSync(out, "utf8")) as { products: Array<{ productID: string }> };
  assert.deepEqual(written.products.map((product) => product.productID), ["pro"]);
  assert.deepEqual(said(calls, "success"), [`Wrote \`${out}\` with 1 product`]);
});

test("products storekit writes Superwall.storekit here by default, and --json says where", async () => {
  const dir = scratch();
  process.chdir(dir);
  const { result } = await storekit({ project: "1" }, [{ identifier: "a" }, { identifier: "b" }], true);
  assert.deepEqual(result.json, { path: "Superwall.storekit", products: 2 });
  assert.ok(fs.existsSync(path.join(dir, "Superwall.storekit")));

  const { calls } = await storekit({ project: "1" }, []);
  assert.deepEqual(said(calls, "success"), ["Wrote `Superwall.storekit` with 0 products"]);
});
