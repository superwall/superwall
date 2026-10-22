import type { CommandContext } from "@/program/command";
import { apiCall } from "@/ui/spinner";
import { ascTypeDisplay, findAscAppId, listUnimportedAscProducts } from "./products";
import { resolveAscOrgApi, resolveAscTeam } from "../api/request";

export async function printAscProducts(ctx: CommandContext<"required">, app: string, team: string | undefined): Promise<void> {
  const api = await resolveAscOrgApi(ctx);
  const teamId = await resolveAscTeam(ctx, api, team);
  let ascAppId: string | undefined = app;
  if (!/^\d+$/.test(app)) {
    ascAppId = await apiCall(ctx, "Finding app", () => findAscAppId(api, teamId, app));
  }
  if (!ascAppId) throw new Error(`No App Store Connect app found for "${app}".`);
  const id = ascAppId;

  const rows = await apiCall(ctx, "Loading products", () => {
    return listUnimportedAscProducts(api, teamId, id, new Set());
  });
  if (ctx.json) return ctx.output.data(rows);
  ctx.ui.step(`${rows.length} product${rows.length === 1 ? "" : "s"}`);
  for (const p of rows)
    ctx.ui.info(
      `\`${p.productId}\`  ${ascTypeDisplay(p.type)}${p.subscriptionPeriod ? `  ${p.subscriptionPeriod}` : ""}`,
    );
}
