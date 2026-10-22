import { app, dryRun, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { KEY_KINDS } from "@/core/api/integrations";

export const command = defineCommand({
  name: "asc keys create",
  summary: "Create a key at Apple and save it, or save one you hold with --key-file",
  details: `Without --key-file it signs in to Apple, creates one key named "Superwall" on the team
that owns the app's bundle ID, and saves it. An app that already has one creates nothing
unless --replace; the old key stays valid. The password comes from a masked prompt,
SUPERWALL_APPLE_PASSWORD or --apple-password, and goes only to Apple. Without prompts the
first run stops for Apple's code: run it again with --code within 10 minutes. A key
Superwall couldn't save is written to ./AuthKey_<id>.p8, since Apple releases it once.
With --key-file, --key-id and --issuer it saves a key you already hold, once Apple accepts
it. Without --app that becomes your organization's key, the one the signed proxy uses.
A purchase_key is for the app's bundle ID; an app with none gets --bundle-id saved with it.`,
  args: {
    kind: { describe: "api_key or purchase_key (with --key-file and --app, api_key when left out)", choices: KEY_KINDS },
  },
  flags: {
    keyFile: { type: "string", value: "path.p8", describe: "The .p8 file Apple gave you" },
    keyId: { type: "string", value: "id", describe: "Key id, from App Store Connect › Users and Access › Integrations" },
    issuer: { type: "string", value: "id", describe: "Issuer id, shown above the keys in App Store Connect" },
    name: { type: "string", value: "name", describe: "A name for the key in Superwall" },
    bundleId: { type: "string", value: "id", describe: "The bundle ID at Apple, when the app has none saved yet" },
    appleId: { type: "string", value: "email", describe: "Apple Account email, or set SUPERWALL_APPLE_ID" },
    applePassword: {
      verbatim: true,
      type: "string",
      value: "password",
      describe: "Apple Account password; the masked prompt or SUPERWALL_APPLE_PASSWORD keeps it out of shell history",
    },
    code: { type: "string", value: "code", describe: "Apple's verification code, to continue a sign-in started without prompts" },
    sms: { type: "boolean", describe: "Text the code instead of pushing it to trusted devices" },
    phone: { type: "string", value: "number", describe: "Which trusted phone number to text, when the account has several" },
    team: { ...team, value: "id|name", describe: "Apple team id, or a team name when creating a key" },
    keyRole: { type: "string", value: "role", describe: "Role of a new API key: app_manager (default) or admin" },
    replace: { type: "boolean", describe: "Create another key although the app has one; the old one stays valid at Apple" },
    app: { ...app, describe: "The iOS app: id, name or dashboard link" },
    project,
    dryRun: { ...dryRun, describe: "Plan without writing", hidden: true },
  },
  examples: [
    ["asc keys create api_key --app <app>", "Sign in to Apple and create it"],
    ["asc keys create api_key --app <app> --key-id <id> --issuer <id> --key-file <path.p8>", "Save one you hold"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx, input) {
    const { runAscKeysCreate } = await import("@/core/app-store-connect/keys/create");
    return runAscKeysCreate(ctx, input);
  },
});
