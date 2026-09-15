import type { Argv } from "yargs";

export const registerPaywallCommands = <T>(cli: Argv<T>): Argv<T> =>
  cli
  .command(
    "create [dir]",
    "Set up paywalls in your app - creates a superwall/ directory inside it",
    (y) =>
      y
        .positional("dir", {
          type: "string",
          describe: "Your app's root (default: cwd) - paywalls land in superwall/ inside it",
        })
        .options({
          example: {
            type: "string",
            describe: "Start from a public example by name, e.g. --example with-rive",
          },
          from: {
            type: "string",
            describe:
              "Rebuild an existing dashboard paywall as code: scaffold its config.ts (products, presentation, settings) and a migration brief from the paywall id",
          },
          app: {
            type: "string",
            describe: "Connect this Superwall app by id instead of detecting or asking",
          },
          yes: {
            type: "boolean",
            alias: "y",
            describe: "Accept defaults and skip the optional prompts",
          },
          install: {
            type: "boolean",
            default: true,
            describe: "Install dependencies after scaffolding (--no-install to skip)",
          },
          connect: {
            type: "boolean",
            default: true,
            describe: "Connect a Superwall app when possible (--no-connect to skip)",
          },
        })
        .example("$0 create", "Set up superwall/ in the current app")
        .example("$0 create --example with-rive", "Start from an example")
        .example("$0 create --from 65920", "Rebuild dashboard paywall 65920 as code")
        .example("$0 create --app 52518", "Connect a specific Superwall app"),
    (argv) => {
      return import("@/commands/paywalls/create").then((m) => m.runCreate(argv));
    },
  )
  .command(
    "dev [dir..]",
    "Host the studio: browse and preview your paywalls and funnels",
    (y) =>
      y
        .positional("dir", {
          type: "string",
          array: true,
          describe: "Project directories to serve (default: cwd)",
        })
        .options({
          port: {
            type: "number",
            default: 6100,
            alias: "p",
            describe: "Preferred port (falls back to the next free one)",
          },
          host: { type: "string", default: "0.0.0.0", describe: "Host to bind" },
          open: {
            type: "string",
            hidden: true,
            describe: "Open the browser at this studio path once the server is up",
          },
        }),
    (argv) => {
      return import("@/commands/paywalls/dev").then((m) => m.runDev(argv));
    },
  )
  .command(
    "push [dir]",
    "Build and push your paywalls as immutable versions (production untouched)",
    (y) =>
      y
        .positional("dir", { type: "string", describe: "Project directory (default: cwd)" })
        .options({
          id: {
            type: "array",
            string: true,
            describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)",
          },
          platform: {
            type: "array",
            string: true,
            describe:
              "Limit to these platforms (repeatable, or comma-separated) - ios, android, web, flutter, react_native",
          },
          rename: {
            type: "array",
            string: true,
            describe:
              "Declare a renamed directory as <old>=<new> (repeatable) - required in CI, where the resolver cannot prompt",
          },

          message: {
            type: "string",
            alias: "m",
            describe:
              "Publish note recorded in the source commit (only lands when this publish creates a new source commit — unchanged source reuses the existing commit)",
          },
        }),
    (argv) => {
      return import("@/commands/paywalls/push").then((m) => m.runPush(argv));
    },
  )
  .command(
    "promote [dir]",
    "Point production at a pushed version (the latest by default)",
    (y) =>
      y
        .version(false)
        .positional("dir", { type: "string", describe: "Project directory (default: cwd)" })
        .options({
          id: {
            type: "array",
            string: true,
            describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)",
          },
          platform: {
            type: "array",
            string: true,
            describe:
              "Limit to these platforms (repeatable, or comma-separated) - ios, android, web, flutter, react_native",
          },
          version: {
            type: "number",
            alias: "v",
            describe: "Pushed version number to promote (requires a single --id)",
          },
        }),
    (argv) => {
      return import("@/commands/paywalls/promote").then((m) => m.runPromote(argv));
    },
  )
  .command(
    "publish [dir]",
    "Push and promote in one step - build, version, and ship to production",
    (y) =>
      y
        .positional("dir", { type: "string", describe: "Project directory (default: cwd)" })
        .options({
          id: {
            type: "array",
            string: true,
            describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)",
          },
          platform: {
            type: "array",
            string: true,
            describe:
              "Limit to these platforms (repeatable, or comma-separated) - ios, android, web, flutter, react_native",
          },
          rename: {
            type: "array",
            string: true,
            describe:
              "Declare a renamed directory as <old>=<new> (repeatable) - required in CI, where the resolver cannot prompt",
          },

          message: {
            type: "string",
            alias: "m",
            describe:
              "Publish note recorded in the source commit (only lands when this publish creates a new source commit — unchanged source reuses the existing commit)",
          },
        }),
    (argv) => {
      return import("@/commands/paywalls/publish").then((m) => m.runPublish(argv));
    },
  );;
