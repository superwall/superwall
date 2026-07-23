import { defineCommand, type DefinedCommand } from "@/command";
import type { ResourceName } from "@/core/api/resources";
import { addCampaignPlacement, writeStoreKit } from "./resource/actions";
import { create } from "./resource/create";
import { list, useApp, useOrg } from "./resource/list";

export function runResource(resource: ResourceName): DefinedCommand<"required"> {
  return defineCommand({
    name: resource,
    auth: "required",
    output: "both",
    async run(context) {
      const action = (context.argv.action as string | undefined) ?? "list";

      if (action === "list") return list(context, context.api, resource);
      if (action === "create") return create(context, context.api, resource);
      if (action === "use" && resource === "apps") {
        return useApp(context, context.api);
      }
      if (action === "use" && resource === "orgs") {
        return useOrg(context, context.api);
      }
      if (action === "placement" && resource === "campaigns") {
        return addCampaignPlacement(context, context.api);
      }
      if (action === "storekit" && resource === "products") {
        return writeStoreKit(context, context.api);
      }
      throw new Error(`Unknown action "${action}" for ${resource}.`);
    },
  });
}
