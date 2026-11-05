import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { test } from "node:test";
import { ApiError } from "@/core/api/client";
import { runWorkspaceDev, type DevInput, type DevRuntimeSeams } from "@/core/workspaces/dev/run";
import type { RuntimeOptions } from "@/core/workspaces/dev/runtime";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";
import { fakeWrangler, MANIFEST, workspaceProject, writeVendoredSdk } from "../fixture";

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
    let host = "";
    let state: any;
    await runWorkspaceDev(ctx, input(project(), overrides), harness({
      onReady: (urls) => {
        host = urls.host;
      },
      until: async () => {
        state = await (await fetch(`${host}/__dev/state`)).json();
      },
    }).runtime);
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

const waitFor = async (condition: () => boolean, label: string) => {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const atomicSave = (file: string, text: string) => {
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
};

test("every kind of save rebuilds: in place, and renames over the manifest again and again", async () => {
  const root = project();
  const manifestFile = path.join(root, "superwall.json");
  const { ctx } = setup();
  const seams = harness({
    until: async () => {
      const rebuildsAfter = async (save: () => void, label: string) => {
        const before = seams.updates.length;
        const deadline = Date.now() + 20_000;
        while (seams.updates.length === before) {
          assert.ok(Date.now() < deadline, `no rebuild after ${label}`);
          save();
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      };
      await rebuildsAfter(() => fs.writeFileSync(path.join(root, "src", "worker.ts"), "export default {}\n"), "an in-place write");
      await rebuildsAfter(() => atomicSave(path.join(root, "src", "worker.ts"), "export default { a: 1 }\n"), "a rename under src");
      for (const save of [1, 2, 3]) {
        await rebuildsAfter(() => atomicSave(manifestFile, JSON.stringify({ ...MANIFEST, name: `Save ${save}` })), `manifest save ${save}`);
      }
      fs.mkdirSync(path.join(root, "src2"));
      fs.writeFileSync(path.join(root, "src2", "worker.ts"), "export default {}\n");
      fs.rmSync(path.join(root, "src"), { recursive: true });
      fs.renameSync(path.join(root, "src2"), path.join(root, "src"));
      await new Promise((resolve) => setTimeout(resolve, 500));
      await rebuildsAfter(() => fs.writeFileSync(path.join(root, "src", "worker.ts"), "export default { b: 2 }\n"), "a save in a replaced src");
    },
  });
  await runWorkspaceDev(ctx, input(root), seams.runtime);
  assert.ok(seams.updates.length >= 6);
});

test("files that aren't the workspace's don't rebuild it", async () => {
  const root = project();
  const { ctx } = setup();
  const seams = harness({
    until: async () => {
      fs.writeFileSync(path.join(root, "notes.txt"), "x");
      fs.mkdirSync(path.join(root, ".wrangler"));
      fs.writeFileSync(path.join(root, ".wrangler", "x"), "x");
      await new Promise((resolve) => setTimeout(resolve, 600));
    },
  });
  await runWorkspaceDev(ctx, input(root), seams.runtime);
  assert.deepEqual(seams.updates, []);
});

test("a failed rebuild keeps the manifest that matches the running code", async () => {
  const root = project();
  const { ctx } = setup();
  let host = "";
  let rebuild!: () => Promise<void>;
  let failing = false;
  const seams = harness({
    wrangler: async (workspace, args) => {
      if (failing) throw new Error("Expected ; but found x");
      await fakeWrangler("CODE")(workspace, args);
    },
    onReady: (urls, trigger) => {
      host = urls.host;
      rebuild = trigger;
    },
    until: async () => {
      fs.writeFileSync(path.join(root, "superwall.json"), JSON.stringify({ ...MANIFEST, name: "Edited" }));
      failing = true;
      await rebuild();
      const broken = (await (await fetch(`${host}/__dev/state`)).json()) as { manifest: { name: string } };
      assert.equal(broken.manifest.name, MANIFEST.name);
      failing = false;
      await rebuild();
      const fixed = (await (await fetch(`${host}/__dev/state`)).json()) as { manifest: { name: string } };
      assert.equal(fixed.manifest.name, "Edited");
    },
  });
  await runWorkspaceDev(ctx, input(root), seams.runtime);
});

test("a busy port disposes the runtime and says so, with no hang", async () => {
  const blocker = http.createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const busy = (blocker.address() as AddressInfo).port;
  const { ctx } = setup();
  const seams = harness();
  try {
    await assert.rejects(runWorkspaceDev(ctx, input(project(), { port: busy }), seams.runtime), /is already in use/);
    assert.equal(seams.disposed(), 1);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("a cancel registered through the context stops it once, ahead of the normal stop", async () => {
  const root = project();
  const { ctx } = setup();
  const cleanups: Array<() => Promise<void>> = [];
  let removed = 0;
  (ctx as any).onCancel = (cleanup: () => Promise<void>) => {
    cleanups.push(cleanup);
    return () => {
      removed += 1;
    };
  };
  const seams = harness({
    until: async (stop) => {
      await cleanups[0]!();
      assert.equal(seams.disposed(), 1);
      await stop();
    },
  });
  await runWorkspaceDev(ctx, input(root), seams.runtime);
  assert.equal(seams.disposed(), 1);
  assert.equal(removed, 1);
});

test("a signal stops it when there's no terminal listener", async () => {
  const signalled = harness({ until: undefined });
  const running = runWorkspaceDev(setup().ctx, input(project()), signalled.runtime);
  await new Promise((resolve) => setTimeout(resolve, 200));
  process.emit("SIGTERM");
  await running;
  assert.equal(signalled.disposed(), 1);
});

test("--context with --org keeps the organization, and alone skips the lookup", async () => {
  const stateOf = async (overrides: Partial<DevInput>) => {
    const { ctx } = setup();
    let host = "";
    let state: any;
    await runWorkspaceDev(ctx, input(project(), overrides), harness({
      onReady: (urls) => {
        host = urls.host;
      },
      until: async () => {
        state = await (await fetch(`${host}/__dev/state`)).json();
      },
    }).runtime);
    return state.defaults;
  };
  assert.deepEqual(await stateOf({ context: '{"a":1}' }), { context: '{"a":1}', organizationId: "1" });
  assert.deepEqual(await stateOf({ org: undefined, context: '{"a":1}' }), { context: '{"a":1}' });
});
