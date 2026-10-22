import { actionById, type ActionContext } from "@/core/workflows/agent/actions";
import type { AgentDriver } from "@/core/workflows/agent/drivers/index";
import { listResource, rowName, type Row } from "@/core/api/resources";
import type { StageCtx } from "@/core/workflows/dashboard-setup";
import { readReport } from "@/core/state/reports";
import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import { runActionWithUI } from "./agent";

export async function runCampaignsAndPlacements(
  driver: AgentDriver,
  fallbackDrivers: AgentDriver[],
  actionContext: ActionContext,
  stageContext: StageCtx,
  ensureAgentReady: () => Promise<boolean>,
): Promise<void> {
  const { api, scope } = stageContext;
  const campaigns = await withSpinner("Checking campaigns", () =>
    listResource(api, "campaigns", scope),
  );

  if (campaigns.length) {
    ui.list({
      items: campaigns.map((campaign) => {
        const placements = placementsOf(campaign);
        return {
          label: rowName(campaign),
          meta: String(campaign.id ?? ""),
          children: placements.length
            ? placements.map((placement) => ({
                label: placement.event_name ?? "",
                badge: placement.enabled === false ? "off" : undefined,
              }))
            : [{ label: "no placements yet" }],
        };
      }),
    });
  } else {
    ui.info("No campaigns yet.");
  }

  if (!(await ui.confirm({ message: "Review your placements & campaigns now?" }))) {
    return;
  }

  const context: ActionContext = {
    ...actionContext,
    campaigns: campaignSummary(campaigns),
  };
  if (!(await ensureAgentReady())) return;
  await runActionWithUI(driver, fallbackDrivers, actionById["placements-review"], context);

  if (await ui.confirm({ message: "Apply the suggested changes?" })) {
    if (!(await ensureAgentReady())) return;
    await runActionWithUI(driver, fallbackDrivers, actionById["placements-implement"], {
      ...context,
      priorReport: readReport(actionContext.app.path, "placements-review"),
    });
  }

  if (
    await ui.confirm({
      message: "Create campaigns so these placements can present paywalls?",
    })
  ) {
    if (!(await ensureAgentReady())) return;
    await runActionWithUI(driver, fallbackDrivers, actionById["dashboard-setup"], context);
  }
}

interface CampaignPlacement {
  event_name?: string;
  enabled?: boolean;
}

function placementsOf(campaign: Row): CampaignPlacement[] {
  return (campaign.placements as CampaignPlacement[] | undefined) ?? [];
}

function campaignSummary(campaigns: Row[]): string {
  if (!campaigns.length) {
    return "No campaigns exist yet - the app will likely need at least one.";
  }
  return campaigns
    .map((campaign) => {
      const names = placementsOf(campaign)
        .map((placement) => placement.event_name)
        .filter(Boolean)
        .join(", ");
      return `- ${rowName(campaign)}: ${names || "(no placements)"}`;
    })
    .join("\n");
}
