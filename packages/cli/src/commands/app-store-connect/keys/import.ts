import { app, dryRun, project } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { KEY_KINDS, keyKind } from "@/core/api/integrations";
import { importKeys, copyKey } from "@/core/app-store-connect/keys/saved";

export const command = defineCommand({
  name: "asc keys import",
  summary: "Reuse a key your organization already has, once Apple confirms it here",
  details: `Without --from it tries every key your organization has and saves the first Apple
confirms, both kinds when none is named; exit 1 when a kind is still missing. With --from
it copies that app's key. Never saves an unconfirmed key unless a person passes
--allow-unconfirmed, and creates nothing at Apple.

With --from, replaces the target app's saved key.`,
  args: {
    kind: { describe: "api_key or purchase_key (both when left out; needed with --from)", choices: KEY_KINDS },
  },
  flags: {
    from: { type: "string", value: "app", describe: "Import the key of this app instead of trying them all: id, name or link" },
    allowUnconfirmed: {
      type: "boolean",
      describe: "Save an API key although Apple couldn't confirm its team owns this app. A person's decision",
    },
    app: { ...app, describe: "The iOS app: id, name or dashboard link" },
    project,
    dryRun: { ...dryRun, describe: "Plan without writing", hidden: true },
  },
  examples: [
    ["asc keys import --app <app>", "Try your organization's keys on the app"],
    ["asc keys import api_key --app <app> --from <app>", "Copy another app's key"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "destructive",
  run(ctx, { args, flags }) {
    const kind = keyKind(args.kind);
    const app = { app: flags.app, project: flags.project };
    if (flags.from === undefined) return importKeys(ctx, kind, app);
    return copyKey(ctx, kind, flags.from, flags.allowUnconfirmed, app);
  },
});
