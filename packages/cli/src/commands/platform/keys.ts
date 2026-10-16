import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { CommandContext } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import { createAscConfig, deleteAscConfig, listAscConfigs, replaceAscConfig } from "@/core/api/asc";
import { rowName } from "@/core/api/resources";
import { apiCall, emitJson } from "@/commands/api-output";
import {
  copyAppKeyCommand,
  importAppKeys,
  listAppKeySources,
  listAppKeys,
  removeAppKeyCommand,
  setAppKey,
} from "./app-keys";
import { appleDeps } from "./apple-deps";
import { createAppKey, keyKind, text } from "./apple-keys";

export async function runAscKeys(
  ctx: CommandContext<"required">,
  orgApi: () => Promise<SuperwallApi>,
): Promise<void> {
  const action = (ctx.argv.value as string | undefined) ?? "list";
  const forApp = text(ctx, "app") !== undefined;
  if (action === "list") return forApp ? listAppKeys(ctx) : listKeys(ctx, orgApi);
  if (action === "set") return setKey(ctx, orgApi, forApp);
  if (action === "rm") return forApp ? removeAppKeyCommand(ctx) : removeKey(ctx, orgApi);
  if (action === "create") return createAppKey(ctx, appleDeps);
  if (action === "sources") return listAppKeySources(ctx);
  if (action === "copy") return copyAppKeyCommand(ctx);
  if (action === "import") return importAppKeys(ctx);
  throw new Error(
    `Unknown "asc keys ${action}". Use list | set | rm | create | sources | copy | import.`,
  );
}

async function listKeys(
  ctx: CommandContext<"required">,
  orgApi: () => Promise<SuperwallApi>,
): Promise<void> {
  const api = await orgApi();
  const configs = await apiCall(ctx, "Loading credentials", () => listAscConfigs(api));
  if (ctx.json) return emitJson(ctx, configs);

  if (configs.length === 0) {
    ctx.ui.step("No App Store Connect credentials yet");
    if (ctx.interactive) {
      const add = await ctx.ui.confirm({
        message: "Connect an App Store Connect key now?",
      });
      if (add) return setKey(ctx, async () => api, false);
      return;
    }
    ctx.ui.info("Add one: superwall asc keys set --key-id <id> --issuer <id> --key-file <path.p8>");
    return;
  }

  ctx.ui.step(`${configs.length} App Store Connect credential${configs.length === 1 ? "" : "s"}`);
  for (const c of configs) ctx.ui.info(`\`${rowName(c)}\`  ${c.team_id ?? c.id ?? ""}`);
}

async function setKey(
  ctx: CommandContext<"required">,
  orgApi: () => Promise<SuperwallApi>,
  forApp: boolean,
): Promise<void> {
  const input = await resolveKeyInput(ctx, forApp);
  if (!input) return void ctx.ui.warn("Cancelled.");
  if (forApp) return setAppKey(ctx, input);
  const { keyId, issuerId, keyFile, accountName } = input;
  const teamId = text(ctx, "team");

  if (ctx.dryRun) {
    const plan = { dryRun: true, action: "set", keyId, issuerId, keyFile, ...(teamId ? { teamId } : {}) };
    return void (ctx.json
      ? emitJson(ctx, plan)
      : ctx.ui.info(
          `[dry-run] would upload ASC key ${keyId} (issuer ${issuerId}) from ${keyFile}`,
        ));
  }

  const privateKey = readFileSync(keyFile, "utf8");
  const credentials = { keyId, issuerId, privateKey, accountName };
  const api = await orgApi();
  const created = await apiCall(ctx, "Connecting App Store Connect", () =>
    teamId
      ? replaceAscConfig(api, teamId, credentials)
      : createAscConfig(api, { ...credentials, accountName: accountName ?? "App Store Connect" }),
  );
  if (ctx.json) return emitJson(ctx, created);
  ctx.ui.success(`App Store Connect connected ${created.team_id ?? created.id ?? ""}`);
}

async function removeKey(
  ctx: CommandContext,
  orgApi: () => Promise<SuperwallApi>,
): Promise<void> {
  const teamId = ctx.argv.value2 as string | undefined;
  if (!teamId) throw new Error("Usage: superwall asc keys rm <team_id>");
  if (keyKind(teamId)) {
    throw new Error(`Usage: superwall asc keys rm ${teamId} --app <id>`);
  }
  if (ctx.dryRun) {
    const plan = { dryRun: true, action: "rm", teamId };
    return void (ctx.json
      ? emitJson(ctx, plan)
      : ctx.ui.info(`[dry-run] would delete ASC credential ${teamId}`));
  }
  const api = await orgApi();
  await apiCall(ctx, "Removing credential", () => deleteAscConfig(api, teamId));
  if (ctx.json) return emitJson(ctx, { deleted: true, teamId });
  ctx.ui.success(`Removed App Store Connect credential ${teamId}`);
}

export interface KeyInput {
  keyId: string;
  issuerId: string;
  keyFile: string;
  accountName?: string;
}

async function resolveKeyInput(ctx: CommandContext, forApp: boolean): Promise<KeyInput | null> {
  const { argv, ui, interactive } = ctx;
  let keyId = (argv["key-id"] as string | undefined)?.trim();
  let issuerId = (argv.issuer as string | undefined)?.trim();
  let keyFile = (argv["key-file"] as string | undefined)?.trim();
  let name = (argv.name as string | undefined)?.trim();

  if (interactive && (!keyId || !issuerId || !keyFile)) {
    ui.note(
      forApp
        ? "You'll need the key's Key ID, its Issuer ID, and the downloaded .p8 file,\nfrom App Store Connect → Users and Access → Integrations."
        : "Create a key in App Store Connect → Users and Access → Integrations →\nApp Store Connect API. You'll need its Key ID, the Issuer ID, and the\ndownloaded .p8 file. This is stored org-wide for the signed proxy.",
      forApp ? "Save an Apple key on the app" : "Connect App Store Connect",
    );
    if (!keyId) {
      const v = await ui.text({
        message: "Key ID",
        placeholder: "2X9R4HXF34",
        validate: (s) => (s?.trim() ? undefined : "Required"),
      });
      if (v === null) return null;
      keyId = v.trim();
    }
    if (!issuerId) {
      const v = await ui.text({
        message: "Issuer ID",
        placeholder: "57246542-96fe-1a63-e053-0824d011072a",
        validate: (s) => (s?.trim() ? undefined : "Required"),
      });
      if (v === null) return null;
      issuerId = v.trim();
    }
    if (!keyFile) {
      const v = await ui.text({
        message: "Path to the .p8 key file",
        placeholder: "~/Downloads/AuthKey_2X9R4HXF34.p8",
        validate: (s) => {
          const path = expandHome(s?.trim() ?? "");
          if (!path) return "Required";
          if (!existsSync(path)) return "No file at that path";
          return undefined;
        },
      });
      if (v === null) return null;
      keyFile = v.trim();
    }
    if (!name && !forApp) {
      const v = await ui.text({
        message: "Name (optional)",
        placeholder: "App Store Connect",
      });
      if (v === null) return null;
      name = v.trim();
    }
  }

  if (!keyId || !issuerId || !keyFile) {
    throw new Error(
      forApp
        ? "Usage: superwall asc keys set [api_key | purchase_key] --app <id> --key-id <id> --issuer <id> --key-file <path.p8>"
        : "Usage: superwall asc keys set --key-id <id> --issuer <id> --key-file <path.p8> [--name <name>] [--team <id>]",
    );
  }
  const path = expandHome(keyFile);
  if (!existsSync(path)) {
    throw new Error(`Couldn't find the .p8 key file at ${keyFile}`);
  }
  return {
    keyId,
    issuerId,
    keyFile: path,
    ...(name ? { accountName: name } : {}),
  };
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path;
}
