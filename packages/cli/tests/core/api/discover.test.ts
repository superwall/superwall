import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createSuperwallApi } from "@/core/api/client";
import { discoverPublicApiKey } from "@/core/api/discover";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => {
  restoreFetch();
  clearHomes();
});

const api = () =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });

function serveProjects(applications: object[]) {
  useHome();
  return useFetch([{ match: "/v2/projects", body: { data: [{ id: "1", applications }], has_more: false } }]);
}

test("discoverPublicApiKey returns the only app that has a public key", async () => {
  const demo = { id: "10", name: "Demo", public_api_key: "pk_demo" };
  const log = serveProjects([{ id: "9", name: "Keyless" }, demo]);
  assert.deepEqual(await discoverPublicApiKey(api()), { apiKey: "pk_demo", app: demo });
  assert.equal(log[0]?.url, "https://api.example.com/v2/projects?limit=100");
});

test("discoverPublicApiKey finds nothing when no app has a public key", async () => {
  serveProjects([{ id: "9" }, { id: "10", public_api_key: "" }]);
  assert.equal(await discoverPublicApiKey(api()), null);
});

test("discoverPublicApiKey won't guess between several apps with keys", async () => {
  serveProjects([
    { id: "9", public_api_key: "pk_a" },
    { id: "10", public_api_key: "pk_b" },
  ]);
  assert.equal(await discoverPublicApiKey(api()), null);
});
