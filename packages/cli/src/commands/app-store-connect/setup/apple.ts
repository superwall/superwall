import { app, dryRun, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "setup apple",
  summary: "One Apple sign-in: create the keys an app is missing, set its notification URL",
  details: `What it does
  One Apple sign-in, then for one iOS app: creates the App Store Connect
  API key and the In-App Purchase key the app does not already have, saves
  them on the app, and sets the server notification URL where Apple has
  none. It can also create the Superwall app from an App Store Connect
  app. Each step is one of the single commands in \`superwall asc --help\`.

Bundle ID
  An app with no bundle ID gets the App Store Connect app's: saved with the
  In-App Purchase key, both or neither, or on its own before the
  notification URL when that key isn't created. It says how many reported
  builds would run in test mode.

What it never does
  It never creates a second key of a kind the app already has (reported as
  already saved), never replaces a server notification URL another server
  holds, never revokes a key, never replaces an app's different bundle ID (it
  stops before anything is created and points at apps update --bundle-id),
  and never changes the revenue provider (\`superwall apps update --revenue-provider\`).

Sign-in
  The Apple password comes from a masked prompt, SUPERWALL_APPLE_PASSWORD
  or --apple-password. It goes only to Apple and is not saved. Without
  prompts, the first run stops for Apple's verification code
  (verification_required): run it again with --code within 10 minutes.

Exit codes
  0 when every step is done or skipped. 1 when a step failed or a
  verification code is needed. --json lists each step under steps and the
  failed ones under failed.`,
  flags: {
    appleId: { type: "string", value: "email", describe: "Apple Account email (or set SUPERWALL_APPLE_ID)" },
    applePassword: {
      verbatim: true,
      type: "string",
      value: "password",
      describe: "Apple Account password; the masked prompt or SUPERWALL_APPLE_PASSWORD keeps it out of shell history",
    },
    code: { type: "string", value: "code", describe: "Apple's verification code, to continue a sign-in started without prompts" },
    sms: { type: "boolean", describe: "Text the verification code instead of pushing it to trusted devices" },
    phone: { type: "string", value: "number", describe: "Trusted phone number to text, if the account has several" },
    team: { ...team, value: "id|name", describe: "Apple team id or name, if the account is on several" },
    app: { ...app, describe: "The app: id, name or dashboard link" },
    project,
    bundleId: { type: "string", value: "id", describe: "Bundle ID of the App Store Connect app" },
    keyRole: { type: "string", value: "role", describe: "Role of the new API key: app_manager (default) or admin" },
    skipApiKey: { type: "boolean", describe: "Don't create an App Store Connect API key" },
    skipPurchaseKey: { type: "boolean", describe: "Don't create an In-App Purchase key" },
    skipNotificationUrl: { type: "boolean", describe: "Don't set the server notification URL" },
    dryRun: { ...dryRun, describe: "Sign in and check key access without creating or changing anything" },
  },
  examples: [
    ["setup apple", "Sign in and connect an app, with prompts"],
    ["setup apple --dry-run", "Sign in and check key access; change nothing"],
    [
      "setup apple --apple-id you@example.com --app 123 --no-interactive",
      "Without prompts: reads SUPERWALL_APPLE_PASSWORD, then stops for Apple's code",
    ],
    ["setup apple --code 123456 --app 123 --no-interactive", "Continue with the code"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx, input) {
    const { runSetupApple } = await import("@/core/app-store-connect/setup/apple");
    return runSetupApple(ctx, input);
  },
});
