import type { SuperwallApi } from "@/core/api/client";
import { listOrgGroups, listOrganizations } from "@/core/api/orgs";
import { rowName, titleCase, type Row } from "@/core/api/resources";
import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";

export async function orgForNewProject(
  api: SuperwallApi,
  interactive: boolean,
  { org, orgFlag = false }: { org?: string; orgFlag?: boolean } = {},
): Promise<string> {
  const orgs = await withSpinner("Loading your account", () => listOrganizations(api));
  const [first] = orgs;
  if (!first) {
    throw new Error("Your account has no organization yet - run `superwall login` to create one.");
  }
  if (org !== undefined) {
    if (orgs.some((o) => String(o.id) === org)) return org;
    throw new Error(`You don't belong to organization ${org} - yours are ${orgList(orgs)}.`);
  }
  if (orgs.length === 1) return String(first.id);
  if (!interactive) {
    const pick = orgFlag ? "pass --org <id> for one of them, " : "run this interactively to choose, ";
    throw new Error(
      `You belong to ${orgs.length} organizations (${orgList(orgs)}), so a new project needs a home: ${pick}or pass --project <id> to add the app to an existing project.`,
    );
  }
  return chooseOrg(orgs, "Which organization should own the new project?");
}

function orgList(orgs: Row[]): string {
  return orgs.map((o) => `${rowName(o)} (${o.id})`).join(", ");
}

async function chooseOrg(orgs: Row[], message: string): Promise<string> {
  const sel = await ui.select({
    message,
    options: orgs.map((o) => ({
      value: String(o.id),
      label: rowName(o),
      hint: titleCase(String(o.role ?? "")),
    })),
  });
  if (sel === null) throw new Error("Cancelled.");
  return sel;
}

export async function chooseOrgOfApps(api: SuperwallApi, message: string): Promise<string> {
  const groups = await listOrgGroups(api);
  return chooseOrg(
    groups.map((group) => ({
      id: group.id,
      name: group.name ?? `Organization ${group.id}`,
      role: group.member ? "" : "not a member",
    })),
    message,
  );
}
