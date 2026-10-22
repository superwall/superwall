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
          poll: {
            type: "boolean",
            describe: "Finish a login started without a terminal, once it's approved in the browser",
          },
          timeout: {
            type: "number",
            describe: "--poll: seconds to wait for approval before returning (default 60)",
          },
          "org-name": {
            type: "string",
            describe: "Create this organization if the account has none (without a terminal)",
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
      "Report a bug or send feedback to the Superwall team",
      (y) =>
        y
          .positional("message", {
            type: "string",
            describe:
              "What happened: what you ran, what you expected, what you got (omit to be prompted)",
          })
          .options({
            title: { type: "string", describe: "One-line summary" },
            kind: {
              type: "string",
              choices: ["bug", "docs", "idea", "praise", "other"],
              describe: "What this is (default: other)",
            },
            command: { type: "string", describe: "The command or call that misbehaved" },
            project: {
              type: "string",
              describe: "Project id it happened in (defaults to this directory's linked app)",
            },
            app: {
              type: "string",
              describe: "App id it happened in (defaults to this directory's linked app)",
            },
            context: {
              type: "string",
              array: true,
              describe:
                "Repro context as key=value, repeatable (paywall=…, placement=…, sdk=ios@4.5.0, device=…)",
            },
            file: {
              type: "string",
              array: true,
              describe:
                "Attach a log or snippet (repeatable, max 5; '-' reads stdin; long files keep the last 20k chars)",
            },
            agent: {
              type: "string",
              describe: "The agent sending it (auto-detected when possible)",
            },
          })
          .example('$0 feedback "migrate crashed on Expo"', "Send feedback")
          .example(
            '$0 feedback "push fails with 413 on a 2MB asset; expected upload" --title "push 413 on large asset" --kind bug --command "superwall push" --app 123 --context paywall=pw_abc --file push.log --json',
            "For agents: a full bug report",
          ),
      (argv) => {
        return import("@/commands/account/feedback").then((m) => m.runFeedback(argv));
      },
    );
