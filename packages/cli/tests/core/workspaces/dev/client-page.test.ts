import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { bundleWorkspace } from "@/core/workspaces/bundle";
import { runWorkspaceDev } from "@/core/workspaces/dev/run";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";
import { scratch } from "../fixture";

const CLI_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const REPO_ROOT = path.resolve(CLI_ROOT, "../..");
const STARTER = path.join(REPO_ROOT, "workspaces/starter");
const cliRequire = createRequire(path.join(CLI_ROOT, "package.json"));

const packageDir = (name: string) => path.dirname(cliRequire.resolve(`${name}/package.json`));

function linkDependencies(root: string): void {
  fs.mkdirSync(path.join(root, "node_modules/@superwall"), { recursive: true });
  fs.cpSync(path.join(STARTER, "vendor/workspace-sdk"), path.join(root, "node_modules/@superwall/workspace-sdk"), { recursive: true });
  fs.symlinkSync(packageDir("wrangler"), path.join(root, "node_modules/wrangler"));
  const reactDom = packageDir("react-dom");
  const reactDomRequire = createRequire(path.join(reactDom, "package.json"));
  for (const [name, dir] of [
    ["react", packageDir("react")],
    ["react-dom", reactDom],
    ["scheduler", path.dirname(reactDomRequire.resolve("scheduler/package.json"))],
    ["loose-envify", path.dirname(reactDomRequire.resolve("loose-envify/package.json"))],
  ] as const) {
    fs.cpSync(dir, path.join(root, "node_modules", name), { recursive: true, dereference: true });
  }
}

const REACT_PAGE: Record<string, string> = {
  "superwall.json": JSON.stringify({
    name: "Client page fixture",
    client: { entry: "ui/client.tsx" },
    scopes: ["projects:read"],
    entrypoints: [{ id: "home", slot: "org.page@1", title: "Home", path: "/" }],
  }),
  "package.json": JSON.stringify({ name: "client-page-fixture", private: true, type: "module" }),
  "wrangler.jsonc": '{ "name": "client-page-fixture", "main": "src/worker.ts", "compatibility_date": "2026-09-01" }',
  "src/worker.ts": `
import client from "@superwall/workspace-sdk/client-bundle";
import { clientPage, defineWorkspace, superwallFetch } from "@superwall/workspace-sdk/server";

export default defineWorkspace({
  client,
  fetch: async ({ request }) => {
    if (new URL(request.url).pathname === "/api/projects") {
      const projects = await superwallFetch("/v2/projects");
      return Response.json({ status: projects.status, body: await projects.json() });
    }
    return clientPage(client, { title: "Client page fixture" });
  },
});
`,
  "ui/client.tsx": `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { label } from "./label";
import "./styles.css";

const App = () => {
  const [count, setCount] = useState(0);
  return (
    <main className="card" data-rendered="react">
      <h1 className="badge">Rendered by React</h1>
      <button type="button" onClick={() => setCount(count + 1)}>{label(count)}</button>
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
`,
  "ui/label.ts": "export const label = (count: number): string => `${count} clicks in TypeScript`;\n",
  "ui/styles.css": '.card { color: rgb(12, 74, 110); }\n.badge::before { content: url("./mark.svg"); }\n',
  "ui/mark.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" /></svg>',
  // It would turn JSX into something else if the build read it.
  "tsconfig.json": '{ "compilerOptions": { "jsx": "preserve", "jsxImportSource": "not-react" } }',
};

const reactPage = (): string => {
  const root = scratch("client-page");
  for (const [file, content] of Object.entries(REACT_PAGE)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  linkDependencies(root);
  return root;
};

function context() {
  const calls: RendererCall[] = [];
  return {
    calls,
    ctx: {
      ui: recordingRenderer(calls),
      interactive: false,
      outputMode: "text",
      api: {
        host: "https://api.test",
        post: async (_route: string, body: { organization_id?: number }) => ({ token: "real-workerd-token", organization_id: body.organization_id }),
      },
    } as never,
  };
}

const JSON_API = (async (url: string, init: RequestInit) =>
  Response.json({
    url,
    authorization: (init.headers as Headers).get("authorization"),
    data: [{ name: "Project one" }],
  })) as never;

async function waitUntil(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.fail(message);
}

type Mounted = {
  page: (pathname: string) => Promise<Response>;
  scriptOf: () => Promise<{ path: string; text: string; style: string | null }>;
};

async function devOn(root: string, drive: (mounted: Mounted) => Promise<void>): Promise<void> {
  let host = "";
  let frame = "";
  const { ctx } = context();
  await runWorkspaceDev(
    ctx,
    { dir: root, port: 0, org: "21450" },
    {
      fetchImpl: JSON_API,
      onReady: (urls) => {
        host = urls.host;
        frame = urls.frame;
      },
      until: async () => {
        const created = await fetch(`${host}/__dev/sessions`, {
          method: "POST",
          headers: { origin: host },
          body: JSON.stringify({ entrypoint: "home", input: {} }),
        });
        const { connect_url } = (await created.json()) as { connect_url: string };
        const connected = await fetch(connect_url, { redirect: "manual" });
        const cookie = connected.headers.get("set-cookie")!.split(";")[0]!;
        const page = (pathname: string) => fetch(`${frame}${pathname}`, { headers: { cookie } });
        await drive({
          page,
          scriptOf: async () => {
            const html = await (await page("/")).text();
            const scriptPath = /<script type="module" src="([^"]+)"/.exec(html)![1]!;
            const stylePath = /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1];
            return {
              path: scriptPath,
              text: await (await page(scriptPath)).text(),
              style: stylePath === undefined ? null : await (await page(stylePath)).text(),
            };
          },
        });
      },
    },
  );
}

const page = (config: string, files: Record<string, string> = {}): string => {
  const root = reactPage();
  fs.writeFileSync(path.join(root, "wrangler.jsonc"), config);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
};
const BASE_CONFIG = '"name": "x", "main": "src/worker.ts", "compatibility_date": "2026-09-01"';

describe("the wrangler config on real wrangler, as the builder reads it", () => {
  test("anything the builder refuses stops here too, in its words", { timeout: 120_000 }, async () => {
    const refused: readonly (readonly [string, RegExp])[] = [
      ['"vars": { "A": "b" }', /Environment variables and secrets are not supported.*found: vars/],
      ['"site": { "bucket": "./public" }', /The platform serves a workspace.*found: site/],
      ['"analytics_engine_datasets": [{ "binding": "A" }]', /Bindings are not supported.*found: analytics_engine_datasets/],
      ['"env": { "staging": {} }', /Wrangler environments are not supported.*found: definedEnvironments/],
      ['"build": { "command": "make" }', /Custom build commands are not supported/],
      ['"triggers": { "crons": ["0 9 * * *"] }', /Cron triggers belong in superwall\.json/],
    ];
    await Promise.all(
      refused.map(async ([setting, message]) => {
        await assert.rejects(bundleWorkspace(page(`{ ${BASE_CONFIG}, ${setting} }`)), (error: Error) => {
          assert.match(error.message, /^This would fail on the builder\. /);
          assert.match(error.message, message);
          return true;
        });
      }),
    );
  });

  test("no config, an unreadable one, and one with no compatibility date are all refused", { timeout: 120_000 }, async () => {
    const none = reactPage();
    fs.rmSync(path.join(none, "wrangler.jsonc"));
    await assert.rejects(bundleWorkspace(none), /No wrangler config \(wrangler\.jsonc, wrangler\.json or wrangler\.toml\) was found/);
    await assert.rejects(bundleWorkspace(page("{ nope")), /The wrangler config could not be read/);
    await assert.rejects(bundleWorkspace(page('{ "name": "x", "main": "src/worker.ts" }')), /needs a compatibility_date/);
  });

  test("a committed .env has no effect, and neither does one in your shell", { timeout: 120_000 }, async () => {
    const dotenv = "CLOUDFLARE_ENV=staging\nWRANGLER_BUILD_CONDITIONS=nope\n";
    const config = `{ ${BASE_CONFIG} }`;
    const committed = await bundleWorkspace(page(config, { ".env": dotenv, ".env.local": dotenv }));
    assert.ok(committed.bytes > 0);
    process.env.CLOUDFLARE_ENV = "staging";
    try {
      assert.ok((await bundleWorkspace(page(config))).bytes > 0);
    } finally {
      delete process.env.CLOUDFLARE_ENV;
    }
  });

  test("a redirect in .wrangler/deploy/config.json has no effect", { timeout: 120_000 }, async () => {
    const root = page(`{ ${BASE_CONFIG} }`, {
      "other/worker.ts": 'export default { fetch: () => new Response("REDIRECTED") };',
      "other/wrangler.json": JSON.stringify({ name: "other", main: "./worker.ts", compatibility_date: "2026-09-01" }),
      ".wrangler/deploy/config.json": JSON.stringify({ configPath: "../../other/wrangler.json" }),
    });
    const { module } = await bundleWorkspace(root);
    assert.ok(!module.includes("REDIRECTED"));
    assert.match(module, /_client/);
  });

  test("a Worker can't read a file outside the repo either", { timeout: 120_000 }, async () => {
    const root = page(`{ ${BASE_CONFIG} }`);
    const beside = `${root}-beside.js`;
    fs.writeFileSync(beside, 'export const beside = "from outside";');
    fs.writeFileSync(
      path.join(root, "src/worker.ts"),
      `import client from "@superwall/workspace-sdk/client-bundle";
import { clientPage, defineWorkspace } from "@superwall/workspace-sdk/server";
import { beside } from "../../${path.basename(beside)}";
export default defineWorkspace({ client, fetch: () => clientPage(client, { title: beside }) });
`,
    );
    try {
      await assert.rejects(bundleWorkspace(root), /The bundle reads files outside the repo, which isn't allowed: \.\.\/.*beside\.js\./);
    } finally {
      fs.rmSync(beside);
    }
  });
});

describe("client.entry on real wrangler, esbuild and workerd", () => {
  test("a React page renders through dev's frame, under the runtime's CSP, and a change anywhere rebuilds it", { timeout: 120_000 }, async () => {
    const root = reactPage();
    await devOn(root, async ({ page, scriptOf }) => {
      const document = await page("/");
      assert.equal(document.status, 200);
      const html = await document.text();
      assert.match(html, /<div id="root"><\/div>/);
      assert.match(html, /<title>Client page fixture<\/title>/);
      assert.match(document.headers.get("content-security-policy") ?? "", /script-src[^;]*'self'/);

      const script = await scriptOf();
      assert.match(script.path, /^\/_client\/[0-9a-f]{16}\.js$/);
      const served = await page(script.path);
      assert.equal(served.status, 200);
      assert.match(served.headers.get("content-type") ?? "", /javascript/);
      assert.match(script.text, /Rendered by React/);
      assert.match(script.text, /clicks in TypeScript/);
      assert.ok(!script.text.includes("not-react"), "tsconfig wasn't read");
      assert.match(script.style ?? "", /data:image\/svg\+xml/);

      const api = (await (await page("/api/projects")).json()) as { status: number; body: { url: string; authorization: string } };
      assert.equal(api.status, 200);
      assert.equal(api.body.url, "https://api.test/v2/projects");
      assert.equal(api.body.authorization, "Bearer real-workerd-token");

      await waitUntil(async () => {
        fs.writeFileSync(path.join(root, "ui/label.ts"), "export const label = (count: number): string => `${count} rebuilt clicks`;\n");
        return (await scriptOf()).text.includes("rebuilt clicks");
      }, "the page never rebuilt");
      assert.notEqual((await scriptOf()).path, script.path, "a new bundle gets a new hash");
    });
  });

  test("a broken change says where, and dev keeps running", { timeout: 120_000 }, async () => {
    const root = reactPage();
    const { ctx, calls } = context();
    let host = "";
    await runWorkspaceDev(
      ctx,
      { dir: root, port: 0, org: "21450" },
      {
        fetchImpl: JSON_API,
        onReady: (urls) => {
          host = urls.host;
        },
        until: async () => {
          await waitUntil(async () => {
            fs.writeFileSync(path.join(root, "ui/label.ts"), "export const label = (\n");
            return calls.some((call) => call.method === "error");
          }, "the failure never showed");
          assert.ok(host);
        },
      },
    );
    const shown = calls.filter((call) => call.method === "error").map((call) => String(call.value)).join();
    assert.match(shown, /ui\/label\.ts:2:0: Unexpected end of file/);
  });

  test("a Worker that imports the bundle with no client declared fails with what to declare", { timeout: 120_000 }, async () => {
    const root = reactPage();
    const manifest = JSON.parse(REACT_PAGE["superwall.json"]!) as { client?: unknown };
    delete manifest.client;
    fs.writeFileSync(path.join(root, "superwall.json"), JSON.stringify(manifest));
    await assert.rejects(bundleWorkspace(root), /client-bundle[\s\S]*Declare the browser entry in superwall\.json/);
  });

  test("the starter's page builds and serves as it ships", { timeout: 120_000 }, async () => {
    const root = scratch("starter");
    for (const file of ["superwall.json", "package.json", "wrangler.jsonc", "tsconfig.json"]) {
      fs.copyFileSync(path.join(STARTER, file), path.join(root, file));
    }
    fs.cpSync(path.join(STARTER, "src"), path.join(root, "src"), { recursive: true });
    linkDependencies(root);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "superwall.json"), "utf8")) as { client?: { entry: string } };
    assert.equal(manifest.client?.entry, "src/client.tsx");

    await devOn(root, async ({ page, scriptOf }) => {
      const script = await scriptOf();
      assert.match(script.text, /Edit src\/client\.tsx to change this page/);
      assert.match(script.style ?? "", /--muted-foreground/);
      const projects = await page("/api/projects");
      const body = (await projects.json()) as { url: string; data: { name: string }[] };
      assert.equal(body.url, "https://api.test/v2/projects?organization_id=21450");
      assert.deepEqual(body.data, [{ name: "Project one" }]);
      assert.equal((await page("/nope")).status, 404);
    });
  });
});
