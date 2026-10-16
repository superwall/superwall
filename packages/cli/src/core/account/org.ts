import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import type { SuperwallApi } from "@/core/api/client";
import { listOrgGroups, listOrganizations } from "@/core/api/orgs";
import { rowName, titleCase, type Row } from "@/core/api/resources";

export async function orgForNewProject(api: SuperwallApi, interactive: boolean): Promise<string> {
  const orgs = await withSpinner("Loading your account", () => listOrganizations(api));
  if (orgs.length === 0) {
    throw new Error("Your account has no organization yet - run `superwall login` to create one.");
  }
  if (orgs.length === 1) return String(orgs[0]!.id);
  if (!interactive) {
    throw new Error(
      `You belong to ${orgs.length} organizations, so a new project needs a home: run this interactively to choose, or pass --project <id> to add the app to an existing project.`,
    );
  }
  return chooseOrg(orgs, "Which organization should own the new project?");
}

export async function chooseOrg(orgs: Row[], message: string): Promise<string> {
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
