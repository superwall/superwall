import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { CommandContext } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import { createAscConfig, deleteAscConfig, listAscConfigs } from "@/core/api/asc";
import { rowName } from "@/core/api/resources";
import { apiCall, emitJson } from "@/commands/api-output";

export async function runAscKeys(ctx: CommandContext, api: SuperwallApi): Promise<void> {
  const action = (ctx.argv.value as string | undefined) ?? "list";
  if (action === "list") return listKeys(ctx, api);
  if (action === "set") return setKey(ctx, api);
  if (action === "rm") return removeKey(ctx, api);
  throw new Error(`Unknown "asc keys ${action}". Use list | set | rm.`);
}

async function listKeys(ctx: CommandContext, api: SuperwallApi): Promise<void> {
  const configs = await apiCall(ctx, "Loading credentials", () => listAscConfigs(api));
  if (ctx.json) return emitJson(ctx, configs);

  if (configs.length === 0) {
    ctx.ui.step("No App Store Connect credentials yet");
    if (ctx.interactive) {
      const add = await ctx.ui.confirm({
        message: "Connect an App Store Connect key now?",
      });
      if (add) return setKey(ctx, api);
      return;
    }
    ctx.ui.info("Add one: superwall asc keys set --key-id <id> --issuer <id> --key-file <path.p8>");
    return;
  }

  ctx.ui.step(`${configs.length} App Store Connect credential${configs.length === 1 ? "" : "s"}`);
  for (const c of configs) ctx.ui.info(`\`${rowName(c)}\`  ${c.team_id ?? c.id ?? ""}`);
}

async function setKey(ctx: CommandContext, api: SuperwallApi): Promise<void> {
  const input = await resolveKeyInput(ctx);
  if (!input) return void ctx.ui.warn("Cancelled.");
  const { keyId, issuerId, keyFile, accountName } = input;

  if (ctx.dryRun) {
    const plan = { dryRun: true, action: "set", keyId, issuerId, keyFile };
    return void (ctx.json
      ? emitJson(ctx, plan)
      : ctx.ui.info(
          `[dry-run] would upload ASC key ${keyId} (issuer ${issuerId}) from ${keyFile}`,
        ));
  }

  const privateKey = readFileSync(keyFile, "utf8");
  const created = await apiCall(ctx, "Connecting App Store Connect", () =>
    createAscConfig(api, { keyId, issuerId, privateKey, accountName }),
  );
  if (ctx.json) return emitJson(ctx, created);
  ctx.ui.success(`App Store Connect connected ${created.team_id ?? created.id ?? ""}`);
}

async function removeKey(ctx: CommandContext, api: SuperwallApi): Promise<void> {
  const teamId = ctx.argv.value2 as string | undefined;
  if (!teamId) throw new Error("Usage: superwall asc keys rm <team_id>");
  if (ctx.dryRun) {
    const plan = { dryRun: true, action: "rm", teamId };
    return void (ctx.json
      ? emitJson(ctx, plan)
      : ctx.ui.info(`[dry-run] would delete ASC credential ${teamId}`));
  }
  await apiCall(ctx, "Removing credential", () => deleteAscConfig(api, teamId));
  if (ctx.json) return emitJson(ctx, { deleted: true, teamId });
  ctx.ui.success(`Removed App Store Connect credential ${teamId}`);
}

interface KeyInput {
  keyId: string;
  issuerId: string;
  keyFile: string;
  accountName: string;
}

async function resolveKeyInput(ctx: CommandContext): Promise<KeyInput | null> {
  const { argv, ui, interactive } = ctx;
  let keyId = (argv["key-id"] as string | undefined)?.trim();
  let issuerId = (argv.issuer as string | undefined)?.trim();
  let keyFile = (argv["key-file"] as string | undefined)?.trim();
  let name = (argv.name as string | undefined)?.trim();

  if (interactive && (!keyId || !issuerId || !keyFile)) {
    ui.note(
      "Create a key in App Store Connect → Users and Access → Integrations →\nApp Store Connect API. You'll need its Key ID, the Issuer ID, and the\ndownloaded .p8 file. This is stored org-wide for the signed proxy.",
      "Connect App Store Connect",
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
    if (!name) {
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
      "Usage: superwall asc keys set --key-id <id> --issuer <id> --key-file <path.p8> [--name <name>]",
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
    accountName: name || "App Store Connect",
  };
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path;
}
