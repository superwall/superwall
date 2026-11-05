// @vitest-environment node
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { startPreviewServer } from "../../src/preview/server";

vi.mock("vite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vite")>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "build", "fixture");
const CHECKOUT = path.join(HERE, "..", "..", "src", "checkout", "index.tsx");

describe("the dev server's JSX runtime", () => {
  let server: ViteDevServer;

  beforeAll(async () => {
    server = await startPreviewServer(FIXTURE, { port: 0, host: "127.0.0.1" });
  }, 60_000);

  afterAll(async () => {
    await server?.waitForRequestsIdle();
    await server?.close();
  }, 60_000);

  it("pins the automatic runtime instead of leaving it to the React plugin", () => {
    expect(vi.mocked(createServer).mock.calls[0]?.[0]?.esbuild).toEqual({
      jsx: "automatic",
      jsxImportSource: "react",
    });
  });

  it("serves the framework's checkout without bare React.createElement", async () => {
    const served = await server.transformRequest(CHECKOUT);

    expect(served?.code).toBeDefined();
    expect(served?.code).not.toMatch(/\bReact\.createElement\b/);
  }, 60_000);
});
