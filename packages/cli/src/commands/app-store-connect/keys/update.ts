import { app, dryRun, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { KEY_KINDS, keyKind } from "@/core/api/integrations";

export const command = defineCommand({
  name: "asc keys update",
  summary: "Replace your organization's key for an Apple team",
  details: `Refused unless Apple confirms the new key belongs to the same team.
With --app it saves the key you hold on that app instead, as asc keys create --key-file does.`,
  args: {
    kind: { describe: "api_key or purchase_key, with --app (default api_key)", choices: KEY_KINDS },
  },
  flags: {
    team: { ...team, describe: "The Apple team id whose key it replaces" },
    keyId: { type: "string", value: "id", describe: "Key id, from App Store Connect › Users and Access › Integrations" },
    issuer: { type: "string", value: "id", describe: "Issuer id, shown above the keys in App Store Connect" },
    keyFile: { type: "string", value: "path.p8", describe: "The .p8 file Apple gave you" },
    name: { type: "string", value: "name", describe: "A name for the key in Superwall" },
    app: { ...app, describe: "The iOS app: id, name or dashboard link" },
    project,
    bundleId: { type: "string", value: "id", describe: "The bundle ID at Apple, when the app has none saved yet" },
    dryRun: { ...dryRun, describe: "Plan without writing", hidden: true },
  },
  examples: [
    ["asc keys update --team <team id> --key-id <id> --issuer <id> --key-file <path.p8>", "Replace a team's key"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx, { args, flags }) {
    const { upsertHeldKey } = await import("@/core/app-store-connect/keys/held");
    return upsertHeldKey(ctx, {
      action: "update",
      key: { keyId: flags.keyId, issuer: flags.issuer, keyFile: flags.keyFile, name: flags.name },
      ...(flags.app === undefined ? {} : { app: { app: flags.app, project: flags.project, bundleId: flags.bundleId } }),
      kind: keyKind(args.kind),
      team: flags.team,
    });
  },
});
