// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
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
const PACKAGE = path.join(HERE, "..", "..");

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

describe("the dev server in a folder whose path contains a colon", () => {
  let server: ViteDevServer;
  let scratch: string;
  let project: string;
  let origin: string;

  beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-colon-"));
    project = path.join(scratch, ":Documents:Paywalls", "proj");
    fs.cpSync(FIXTURE, project, { recursive: true });
    const modules = path.join(project, "node_modules");
    fs.mkdirSync(modules);
    for (const name of ["react", "react-dom"]) {
      fs.symlinkSync(path.join(PACKAGE, "node_modules", name), path.join(modules, name), "dir");
    }
    fs.symlinkSync(PACKAGE, path.join(modules, "superwall"), "dir");
    server = await startPreviewServer(project, { port: 0, host: "127.0.0.1" });
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("no address");
    origin = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await server?.waitForRequestsIdle();
    await server?.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  const get = async (url: string) => {
    const response = await fetch(origin + url);
    return { status: response.status, body: await response.text() };
  };

  it("serves no project path with a colon to Vite", () => {
    const config = server.config;
    expect(config.root).not.toContain(":");
    expect(config.server.fs.allow.filter((dir) => dir.includes(":"))).toEqual([]);
  });

  it("serves a surface config and its stylesheet", async () => {
    expect((await get("/paywalls/demo/config.ts")).status).toBe(200);
    const css = await get("/paywalls/demo/styles.css");
    expect(css.status).toBe(200);
    expect(css.body).toContain("background-image");
  }, 60_000);

  it("serves every route module the project module imports", async () => {
    const surfaces = await get("/@id/__x00__virtual:superwall/project");
    expect(surfaces.status).toBe(200);
    const routes = [...surfaces.body.matchAll(/import\("([^"]+)"\)/g)].map((match) => match[1]!);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((route) => route.includes(":"))).toEqual([]);
    for (const route of routes) {
      const served = await get(route);
      expect({ route, status: served.status }).toEqual({ route, status: 200 });
    }
  }, 120_000);

  it("serves the preview mount and the framework it imports", async () => {
    const page = await get("/preview/paywall/basic");
    expect(page.status).toBe(200);
    const entry = /"(\/@fs\/[^"]*mount\.tsx)"/.exec(page.body)?.[1];
    expect(entry).toBeDefined();
    expect((await get(entry!)).status).toBe(200);
  }, 120_000);

  it("sees edits to the project and invalidates the served module", async () => {
    const config = path.join(project, "superwall", "paywalls", "demo", "config.ts");
    await get("/paywalls/demo/config.ts");
    const served = path.join(server.config.root, "paywalls", "demo", "config.ts");
    expect(server.moduleGraph.getModulesByFile(served)?.size).toBe(1);

    const changed = new Promise<string>((resolve) => {
      server.watcher.on("change", (file) => {
        if (file.endsWith("config.ts")) resolve(file);
      });
    });
    fs.appendFileSync(config, "\n");

    expect(await changed).toBe(served);
  }, 60_000);
});
