import type { Argv } from "yargs";
import { installDirOption } from "./options";

export const registerAccountCommands = <T>(cli: Argv<T>): Argv<T> =>
  cli
  .command(
    "login",
    "Log in to Superwall (opens your browser)",
    (y) =>
      y.options({
        "api-key": {
          type: "string",
          describe: "Log in headlessly with an API key (for CI) instead of the browser",
        },
        host: {
          type: "string",
          describe: "OAuth issuer override",
          hidden: true,
        },
        "client-id": {
          type: "string",
          describe: "OAuth client id override",
          hidden: true,
        },
      }),
    (argv) => {
      return import("@/commands/account/auth").then((m) => m.runLogin(argv));
    },
  )
  .command(
    "logout",
    "Log out of Superwall",
    (y) => y,
    (argv) => {
      return import("@/commands/account/auth").then((m) => m.runLogout(argv));
    },
  )
  .command(
    "whoami",
    "Show the logged-in Superwall account",
    (y) => y,
    (argv) => {
      return import("@/commands/account/auth").then((m) => m.runWhoami(argv));
    },
  )
  .command(
    "skills",
    "Install or update the Superwall agent skills for your coding agent",
    (y) =>
      y.options({
        skill: {
          type: "array",
          describe: "Install specific skills by name (default: all)",
        },
        force: {
          type: "boolean",
          describe: "Reinstall even if skills are already up to date",
        },
        yes: {
          type: "boolean",
          alias: "y",
          describe: "Install all skills without asking",
        },
        "dry-run": {
          type: "boolean",
          describe: "Print the install command without running it",
          hidden: true,
        },
      }),
    (argv) => {
      return import("@/commands/account/skills").then((m) => m.runSkills(argv));
    },
  )
  .command(
    "doctor",
    "Check the health of your Superwall integration",
    (y) =>
      y.options({
        ...installDirOption,
      }),
    (argv) => {
      return import("@/commands/account/doctor").then((m) => m.runDoctor(argv));
    },
  )
  .command(
    "upgrade",
    "Update the CLI to the latest version",
    (y) => y,
    (argv) => {
      return import("@/commands/account/upgrade").then((m) => m.runUpgrade(argv));
    },
  )
  .command(
    "feedback [message]",
    "Send feedback about the CLI to the Superwall team",
    (y) =>
      y
        .positional("message", {
          type: "string",
          describe: "Your feedback (omit to be prompted)",
        })
        .example('$0 feedback "migrate crashed on Expo"', "Send feedback")
        .example('$0 feedback "..." --json', "For agents / automation"),
    (argv) => {
      return import("@/commands/account/feedback").then((m) => m.runFeedback(argv));
    },
  );
