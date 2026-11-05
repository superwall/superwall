import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { ApiError } from "@/core/api/client";
import { runWorkspaceDev, type DevInput, type DevRuntimeSeams } from "@/core/workspaces/dev/run";
import type { RuntimeOptions } from "@/core/workspaces/dev/runtime";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";
import { fakeWrangler, workspaceProject, writeVendoredSdk } from "../fixture";

function setup(api: Record<string, unknown> = {}) {
  const calls: RendererCall[] = [];
  const minted: string[] = [];
  const ctx = {
    ui: recordingRenderer(calls),
    interactive: false,
    outputMode: "text",
    api: {
      host: "https://api.test",
      post: async (route: string) => {
        minted.push(route);
        return { token: `token-${minted.length}` };
      },
      ...api,
    },
  } as never;
  return { ctx, calls, minted, said: (method: string) => calls.filter((call) => call.method === method).map((call) => String(call.value)) };
}

function project() {
  const root = workspaceProject();
  writeVendoredSdk(root, "99.0.0");
  return root;
}

const input = (root: string, overrides: Partial<DevInput> = {}): DevInput => ({ dir: root, port: 0, org: "1", ...overrides });

function harness(seams: Partial<DevRuntimeSeams> = {}) {
  const started: RuntimeOptions[] = [];
  const updates: string[] = [];
  let disposed = 0;
  const runtime: DevRuntimeSeams = {
    wrangler: fakeWrangler("CODE"),
    startRuntime: async (options) => {
      started.push(options);
      return {
        fetch: async () => new Response("page"),
        update: async (code) => void updates.push(code),
        dispose: async () => void (disposed += 1),
      };
    },
    until: async () => {},
    ...seams,
  };
  return { runtime, started, updates, disposed: () => disposed };
}

test("mints a read-only token, bundles, starts the runtime and announces the URL", async () => {
  const { ctx, minted, said } = setup();
  const seams = harness();
  await runWorkspaceDev(ctx, input(project()), seams.runtime);
  assert.deepEqual(minted, ["/v2/me/agent-token"]);
  assert.equal(seams.started[0]!.module, "CODE");
  assert.match(said("success")[0]!, /Open http:\/\/localhost:\d+/);
  assert.match(said("info")[0]!, /read-only/);
  assert.equal(seams.disposed(), 1);
});

test("the runtime's outbound uses the minted token against the session's host", async () => {
  const { ctx } = setup();
  const seen: { url: string; authorization: string | null }[] = [];
  const seams = harness({
    fetchImpl: (async (url: string, init: RequestInit) => {
      seen.push({ url, authorization: (init.headers as Headers).get("authorization") });
      return new Response("{}");
    }) as never,
  });
  await runWorkspaceDev(ctx, input(project()), seams.runtime);
  await seams.started[0]!.outbound(new Request("https://api.workspace.internal/v2/projects"), { narrowed: false });
  assert.deepEqual(seen, [{ url: "https://api.test/v2/projects", authorization: "Bearer token-1" }]);
});

test("an API key can't make the token, and it says what to do", async () => {
  const { ctx } = setup({
    post: async () => {
      throw new ApiError("POST /v2/me/agent-token", 403, '{"message":"not eligible"}');
    },
  });
  await assert.rejects(runWorkspaceDev(ctx, input(project()), harness().runtime), /needs a browser login[\s\S]*superwall login/);
});

test("other API failures pass through", async () => {
  const { ctx } = setup({
    post: async () => {
      throw new ApiError("POST /v2/me/agent-token", 500, '{"message":"down"}');
    },
  });
  await assert.rejects(runWorkspaceDev(ctx, input(project()), harness().runtime), /down/);
});

test("the app and flags become the page's defaults, and --context skips the organization", async () => {
  const flags = {
    app: "42",
    campaign: "3",
    audience: "4",
    variant: ["5"],
    user: "alice",
    alias: ["a2"],
    environment: "SANDBOX",
    from: "2026-10-01T00:00:00Z",
    to: "2026-10-02T00:00:00Z",
  };
  const stateOf = async (overrides: Partial<DevInput>) => {
    const { ctx } = setup();
    let state: any;
    await runWorkspaceDev(ctx, input(project(), overrides), harness({
      onReady: () => {},
      until: async () => {},
    }).runtime);
    const seams = harness({
      onReady: (urls) => {
        state = fetch(`${urls.host}/__dev/state`).then((answer) => answer.json());
      },
      until: () => new Promise((resolve) => setTimeout(resolve, 30)),
    });
    await runWorkspaceDev(ctx, input(project(), overrides), seams.runtime).catch(() => {});
    return state;
  };
  const defaults = (await stateOf(flags)).defaults;
  assert.deepEqual(defaults, {
    campaignId: "3",
    audienceId: "4",
    variantIds: ["5"],
    appUserId: "alice",
    aliases: ["a2"],
    environment: "SANDBOX",
    from: "2026-10-01T00:00:00Z",
    to: "2026-10-02T00:00:00Z",
    organizationId: "1",
    applicationId: "42",
  });
  const custom = (await stateOf({ org: undefined, context: '{"paywallId":1}' })).defaults;
  assert.deepEqual(custom, { context: '{"paywallId":1}' });
});

test("it needs an organization", async () => {
  const { ctx } = setup({ get: async () => ({ data: [{ id: 1 }, { id: 2 }] }) });
  await assert.rejects(runWorkspaceDev(ctx, input(project(), { org: undefined }), harness().runtime), /--org <id>/);
});

test("a change rebuilds and reloads; a broken one is reported and the last good one keeps running", async () => {
  const root = project();
  const { ctx, said } = setup();
  let code = "CODE";
  let rebuild!: () => Promise<void>;
  let host = "";
  const seams = harness({
    wrangler: async (workspace, args) => {
      if (code === "BROKEN") throw new Error("Expected ; but found x");
      await fakeWrangler(code)(workspace, args);
    },
    onReady: (urls, trigger) => {
      host = urls.host;
      rebuild = trigger;
    },
    until: async () => {
      const stream = await fetch(`${host}/__dev/events`);
      const reader = stream.body!.getReader();
      await reader.read();
      code = "NEXT";
      await rebuild();
      assert.match(Buffer.from((await reader.read()).value!).toString(), /"type":"reload"/);
      code = "BROKEN";
      await rebuild();
      assert.match(Buffer.from((await reader.read()).value!).toString(), /Expected ; but found x/);
      await reader.cancel();
    },
  });
  await runWorkspaceDev(ctx, input(root), seams.runtime);
  assert.deepEqual(seams.updates, ["NEXT"]);
  assert.match(said("step")[0]!, /Rebuilt, 4 bytes/);
  assert.match(said("error")[0]!, /Expected ; but found x/);
});

test("saving a file triggers a rebuild on its own", async () => {
  const root = project();
  const { ctx } = setup();
  const seams = harness({
    until: async () => {
      const deadline = Date.now() + 30_000;
      let edit = 0;
      while (seams.updates.length === 0 && Date.now() < deadline) {
        edit += 1;
        fs.writeFileSync(path.join(root, "src", "worker.ts"), `export default { edit: ${edit} }\n`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
  });
  await runWorkspaceDev(ctx, input(root), seams.runtime);
  assert.equal(seams.updates[0], "CODE");
});

test("stops once, on an interrupt or a signal", async () => {
  const root = project();
  const { ctx } = setup();
  const stops: Array<() => void> = [];
  (ctx as any).ui.onInterrupt = (listener: () => void) => {
    stops.push(listener);
    return () => {};
  };
  const seams = harness({
    until: async (stop) => {
      stops[0]!();
      await stop();
    },
  });
  await runWorkspaceDev(ctx, input(root), seams.runtime);
  assert.equal(seams.disposed(), 1);

  const signalled = harness({ until: undefined });
  const running = runWorkspaceDev(setup().ctx, input(project()), signalled.runtime);
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.emit("SIGTERM");
  await running;
  assert.equal(signalled.disposed(), 1);
});
