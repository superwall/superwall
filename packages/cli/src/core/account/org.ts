import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import type { SuperwallApi } from "@/core/api/client";
import { listOrganizations, rowName, titleCase, type Row } from "@/core/api/resources";

export interface OrgRef {
  id: string;
  name?: string;
}

/**
 * Login is user-scoped and doesn't pick an org; org-scoped endpoints resolve
 * one here on first use and persist it to the session.
 */
export async function requireOrg(api: SuperwallApi, interactive: boolean): Promise<OrgRef> {
  if (api.org.id) return { id: api.org.id, name: api.org.name };

  const orgs = await withSpinner("Finding your organization", () => listOrganizations(api));
  if (orgs.length === 0) {
    throw new Error("Your account has no organization yet - run `superwall login` to create one.");
  }

  let picked: Row | undefined = orgs.length === 1 ? orgs[0] : undefined;
  if (!picked) {
    if (!interactive) {
      throw new Error(
        "Your account has multiple organizations - run `superwall orgs use <id|name>` to pick one.",
      );
    }
    const sel = await ui.select({
      message: "Which organization?",
      options: orgs.map((o) => ({
        value: String(o.id),
        label: rowName(o),
        hint: titleCase(String(o.role ?? "")),
      })),
    });
    if (sel === null) throw new Error("An organization is required.");
    picked = orgs.find((o) => String(o.id) === sel)!;
  }

  const org: OrgRef = { id: String(picked.id), name: rowName(picked) };
  api.setOrg(org);
  return org;
}
