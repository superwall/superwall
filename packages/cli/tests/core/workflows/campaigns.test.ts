import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { ActionContext } from "@/core/workflows/agent/actions";
import type { AgentDriver, AgentResult, AgentRunOptions } from "@/core/workflows/agent/drivers/index";
import { scanProject } from "@/core/codebase/scan";
import { runCampaignsAndPlacements } from "@/core/workflows/campaigns";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { answeringRenderer, prompted, said, type Answers } from "../../helpers/answers";
import type { RendererCall } from "../../helpers/renderer";
import { routedApi } from "../../helpers/routed-api";
import { expoApp } from "../../helpers/workflow";

afterEach(() => {
  selectRenderer({ mode: "text" });
});

const CAMPAIGNS = [
  {
    id: 1,
    name: "Onboarding",
    placements: [{ event_name: "campaign_trigger" }, { event_name: "old", enabled: false }, {}],
  },
  { id: 2, name: "Winback" },
];

function agent(results: AgentResult[]): { driver: AgentDriver; seen: AgentRunOptions[] } {
  const seen: AgentRunOptions[] = [];
  return {
    seen,
    driver: {
      id: "claude",
      displayName: "Claude Code",
      detect: async () => null,
      run: async (options) => {
        seen.push(options);
        const result = results.shift();
        if (!result) throw new Error("the agent ran more often than expected");
        return result;
      },
    },
  };
}

async function stage(
  answers: Answers,
  { campaigns = CAMPAIGNS as unknown[], results = [], ready = [] }: { campaigns?: unknown[]; results?: AgentResult[]; ready?: boolean[] } = {},
) {
  const app = (await scanProject(expoApp())).apps[0];
  assert.ok(app);
  let listed = 0;
  const { api } = routedApi({
    "GET /v2/campaigns?application_id=10": () => (listed++, campaigns),
  });
  const calls: RendererCall[] = [];
  useRenderer(answeringRenderer(answers, calls));
  const { driver, seen } = agent(results);
  const readiness = [...ready];
  const actionContext: ActionContext = {
    app,
    apiKey: "pk_live_abcdef",
    existing: { sdkInstalled: true, configureFound: true, fullyIntegrated: true },
  };
  await runCampaignsAndPlacements(
    driver,
    [],
    actionContext,
    { api, scope: { projectId: "1", applicationId: "10" }, appName: "Acme" },
    async () => readiness.shift() ?? true,
  );
  return { calls, seen, app, listed: () => listed };
}

test("the campaigns and their placements are listed before anything is asked", async () => {
  const { calls, seen } = await stage({ confirm: [false] });
  const list = calls.find((call) => call.method === "list")?.value;
  assert.deepEqual(list, {
    items: [
      {
        label: "Onboarding",
        meta: "1",
        children: [
          { label: "campaign_trigger", badge: undefined },
          { label: "old", badge: "off" },
          { label: "", badge: undefined },
        ],
      },
      { label: "Winback", meta: "2", children: [{ label: "no placements yet" }] },
    ],
  });
  assert.deepEqual(prompted(calls, "confirm"), ["Review your placements & campaigns now?"]);
  assert.deepEqual(seen, []);
});

test("with no campaigns it says so, and stops when the agent isn't ready", async () => {
  const { calls, seen } = await stage({ confirm: [true] }, { campaigns: [], ready: [false] });
  assert.deepEqual(said(calls, "info"), ["No campaigns yet."]);
  assert.deepEqual(seen, []);
});

test("agreeing to every step reviews, applies its suggestions, then sets up the dashboard", async () => {
  const { seen, app, calls, listed } = await stage(
    { confirm: [true, true, true] },
    { results: [{ ok: true, finalText: "Add a placement at checkout." }, { ok: true }, { ok: true, finalText: "Created one campaign." }] },
  );
  assert.deepEqual(prompted(calls, "confirm"), [
    "Review your placements & campaigns now?",
    "Apply the suggested changes?",
    "Create campaigns so these placements can present paywalls?",
  ]);
  assert.equal(seen.length, 3);
  assert.match(seen[0]?.prompt ?? "", /- Onboarding: campaign_trigger, old\n- Winback: \(no placements\)/);
  assert.match(seen[1]?.prompt ?? "", /Add a placement at checkout\./);
  assert.match(seen[2]?.prompt ?? "", /public API key is pk_live_abcdef/);
  assert.equal(fs.readFileSync(path.join(app.path, ".superwall", "dashboard-setup.md"), "utf8"), "Created one campaign.");
  assert.equal(listed(), 1);
});

test("with no campaigns the placement review is told the app needs one", async () => {
  const { seen } = await stage({ confirm: [true, false, false] }, { campaigns: [], results: [{ ok: true }] });
  assert.match(seen[0]?.prompt ?? "", /No campaigns exist yet - the app will likely need at least one\./);
});

test("declining the later steps, or an agent that isn't ready for them, runs only the review", async () => {
  const declined = await stage({ confirm: [true, false, false] }, { results: [{ ok: true }] });
  assert.equal(declined.seen.length, 1);

  const unready = await stage({ confirm: [true, true] }, { results: [{ ok: true }], ready: [true, false] });
  assert.equal(unready.seen.length, 1);

  const unreadyLater = await stage({ confirm: [true, false, true] }, { results: [{ ok: true }], ready: [true, false] });
  assert.equal(unreadyLater.seen.length, 1);
});
