# AGENTS.md

> **This package lives in the superwall framework monorepo.** It owns no
> bin: the framework
> package (`packages/superwall`) declares the `superwall`/`sw` binaries, and
> its `bin/superwall.js` calls `main()` from this package's `src/entry.ts`.
> The paywall commands (`create`/`dev`/`push`/`promote`/`publish`) are
> registered in `src/commands/registry.ts` like every other command. Never import
> `superwall` (the framework) from this package — the dependency direction
> is framework → cli only (paywall commands load the framework dynamically
> from the user's project). This package is excluded from the repo's
> oxfmt/oxlint and keeps its own conventions.

# Superwall CLI - agent & contributor guide

Read this before changing anything. These are decided conventions, not suggestions;
when a change conflicts with them, the change is wrong or the convention needs an
explicit decision from the owner first.

## What this package is

The `superwall` CLI is two thin things around the **skills**, which are the product:

1. A **deterministic harness** that runs expert playbooks (skills) through the
   user's own coding agent (Claude Code / Codex, headless).
2. A **router/toolbelt**: authenticated resource + raw API commands agents and
   humans use directly.

All agent-facing expertise lives in the public
[superwall/skills](https://github.com/superwall/skills) repo; nothing
skill-shaped is source in this package, and no list says which skills ship. `bun run
build` bundles every skill of the repo into `dist/skills/`
(`scripts/vendor-skills.ts`): all of `main`, then whatever `next` adds, with
`dist/skills/index.json` recording each skill's channel (`CHANNELS` in
`src/environment.ts` maps `latest` to `main` and `next` to `next`). A new skill
on either branch ships with the next build; nothing in the CLI or the MCP has to
learn its name. `superwall skills` installs every skill of the channel's branch,
and the bundled fallback installs the bundled ones on that channel. Skills can
also come
from a local checkout with
`bun run skills:vendor --from ../../../skills` (or `SUPERWALL_SKILLS_DIR=…
bun run build`; `SUPERWALL_SKILLS_REF=<branch>` bundles every skill from one
branch) while iterating; `bun run test` bundles first when
`dist/skills` is missing. The build fails, on purpose, when a branch lacks a
skill the CLI composes: push the skills repo first. At run time the CLI reads
each playbook from the live copy `superwall login` installed for the user's
agents (`AGENT_SKILLS_DIR`, `~/.agents/skills`) when it is there and falls
back to `dist/skills`, so `--skill` and headless runs use the same text an
agent reads on its own.

**Channels.** `SUPERWALL_CHANNEL` (`CHANNEL()` in `src/environment.ts`, the
only reader) names a key of `CHANNELS`, `latest` unless set to a known one;
`CHANNELS` is the single definition of what a channel is (today: which
skills branch it reads). Skills declare the channel they ship on; commands
that exist only on a channel check `CHANNEL()` where they register. On
`next` the framework
commands (`create`/`dev`/`push`/`promote`/`publish`, `migrate <paywall-id>`,
`migrate --screen`) register and appear in `superwall --help`, and every skills
source (`npx skills add`, the picker listing, the staleness SHA) points at the
skills repo's `next` branch instead of `main`, and the bundled copy installed
at login includes `superwall-framework`; off it only the skills bundled from
`main` are installed (`bundledSkillsForChannel()`), and the commands do not
exist: unknown command, not hidden. The channel is set globally by the
user (shell rc); the CLI never writes it anywhere. Tests run
with the channel set (`tests/setup.ts`); `tests/contracts/channel.test.ts` covers
both states. Nothing framework-shaped may leak to the `latest` surface: no
help row, no skill name, no playbook sentence. The workflow playbooks are nested inside those skills
(`superwall/workflows/<job>/playbook.md` + one file per framework or provider,
`superwall-framework/references/migrate-from-*.md` + `native/<framework>.md`),
and `PLAYBOOKS` maps each `BundledSkillId` to its path. `superwall login`
installs this copy first and the live repo over it, so agents always read the
newest text and the copy is the offline fallback.
TypeScript never contains domain expertise. If you're writing
paywall/migration/integration knowledge in a `.ts` file, stop and put it in a
skill.

## Command design

- **One name per concept. No aliases, no synonyms.** It's `apps`, not projects
  (users think "my app"; `--project` survives only as a scoping flag). It's
  `asc keys` (not secrets - ASC calls them API keys). A second name for the same
  thing is a bug.
- **Workflows are verbs users say**: `integrate`, `migrate`, `review [--fix]`.
  Every workflow takes `--skill` (print the composed playbook instead of running).
- **Resources follow the API, Stripe-style**: `<resource> [nested] <operation>
  [ids..] [--field value]`, each resource declared in its own file
  (`src/commands/main/apps.ts`, … via `defineResource`, `src/core/main/`).
  An operation with `method` + `path` is generic (`src/core/main/operation.ts`): its flags
  are the endpoint's query/body fields from the live OpenAPI index (kebab flag →
  snake field, typed by the spec, unknown flags refused), positionals fill the
  path params left after `--app` fills `project_id`/`application_id`/
  `organization_id` (`bind` maps an app's `{id}` to its project). `handler`
  operations are hand-written (`apps get`'s composed view, `apps list|create|use`,
  `products create|storekit`, ...); a handler may also carry `method` + `path`
  to reuse the generic call (`apps update` checks a new `--bundle-id` for
  test-mode builds, then sends the settings PATCH; `apps get` shows what the
  SDK reported). Every resource and nested resource uses the same verbs:
  `list`, `get`, `create`, `update`, `delete`, plus actions the API names
  (`archive`, `publish`, `readout`). Operations have no aliases. `list` is the
  default; an id in the operation slot means `get`. Destructive operations
  confirm (`--yes` outside a TTY); every operation takes `--dry-run` and
  `--json`. The parser never converts numbers, so a request field is sent as
  typed (`1e3`, `1.10`, a long id); only flags declared `type: "number"`
  become numbers. `--limit` caps projects on `apps list`, rows
  everywhere else.
- **One way to do each thing.** A field of a resource is changed with that
  resource's `update`, never a command of its own (`apps update --bundle-id`,
  `apps update --revenue-provider`), and what a resource shows lives in its
  `get` (`apps get` shows the notification URL, keys, SDK reports and revenue
  provider). `create` takes flags (`--identifier`, `--name`, `--description`,
  `--placement`), never positionals. The revenue provider is set with `apps update`
  but read where it matters, in `query`: `--app` passes `{app}`,
  `{revenue_provider}` and `{revenue_integrations}` as ClickHouse `param_*`
  parameters (the proxy forwards them), with the integration lists from
  `REVENUE_INTEGRATIONS` — the same ones the dashboard's charts filter by.
  Projects are not a resource: `--project`
  only narrows `--app`. `asc keys`: `create` signs in to Apple, or saves a held
  key with `--key-file`; `update --team` replaces an org key; `import` reuses an
  org key (`--from` names one); `delete` removes. Help never prints a bare
  `/path`: terminals like Ghostty link anything that starts with `/`.
- **How the CLI finds things**: the API has no single-application endpoint, so
  an app outside the current organization is found through a paywall that names
  its project, or through the organization a dashboard link names. Org-wide
  endpoints (analytics, App Store Connect, Search Ads) take the organization of
  the app the command is about (`api.forOrg`), so nobody selects one.
  Organizations opened by id or link aren't memberships, so the CLI remembers
  them in its config and lists them, marked not a member. Only GETs are retried:
  a write that timed out may already have landed. The API reference is cached
  for a day and a stale copy still answers offline. A browser login reaches
  every organization and stores no organization name; an API key belongs to one
  and stores its name. `feedback` looks the app's account up best-effort and
  never waits or fails on it.
- **Source pushes never erase.** A version only counts as pushed once its
  source has landed and been linked: `superwall.lock` records the snapshot
  with `sourcePending: <version>` until then, so a rerun finishes that
  version's source instead of skipping it, and neither `publish` nor
  `promote` ever promotes a source-less version. Git and a collectable tree
  are checked before any version exists. The commit each app's source repo
  was last synced to lives in the lock's `sources` (committed, so CI has it;
  the old `.superwall/source.json` is still read and moved there) and
  advances as soon as the git push lands, before the link call, which alone
  is retried on 5xx. A 409 means another publish landed first, so the whole
  push reruns on top of it. With no sync point, a remote whose tree differs
  is refused, naming the files, unless `--overwrite-source`. Git runs with
  hooks, signing and autocrlf off and the caller's `GIT_DIR`-style variables
  dropped, so the user's setup never changes what is committed.
- **Help is one renderer** (`src/program/help.ts`): the root page, topic pages
  and command pages are all drawn from the registry and the specs, in one
  layout (`src/ui/help-layout.ts`). A catalog's `help(words)` uses the same
  layout for its operations, whose flags come from the live API reference.
  Nothing describes a command outside its spec, and yargs' own help is never
  used.
- **Raw API = bare verbs**: `get|post|patch|delete /v2/… [-d k=v]` for ours,
  `asc <verb> /v1/…` for App Store Connect. httpie-style params: `k=v` string,
  `k:=v` typed JSON, `k[sub]` nesting; on get/delete `-d` becomes query params.
- **A removed command is just unknown.** There are no aliases and no
  deprecation shims: `superwall <old>` says "Unknown command". Every removal
  gets a row in the docs' upgrade table (`superwall/docs`,
  `content/docs/agents/cli.mdx` › Upgrading from 1.x), and the `superwall`
  skill changes in the same release (it checks `superwall --version`).
- **Kill commands that don't earn their place.** A command that duplicates
  another's output (scan vs doctor) or has no user (pull/plan) gets deleted,
  not deprecated.
- **Errors are short.** An unknown command, flag or argument, or a bad value,
  is refused by the parser before anything runs: `✗ message` + "Run superwall
  <command> --help for usage.", exit 1 (`invalid_arguments` under `--json`).
  Never dump the full help on failure.

## Commands: one system

Every command is built the same way, and `tests/contracts/commands.test.ts`
fails the build when one isn't.

- **A help section is a directory.** `src/commands/<group>/` is one section of
  `superwall --help`, in the order and with the title `src/commands/registry.ts`
  gives it: `workflows`, `paywalls` (next channel), `main` (titled
  Commands), `analytics`, `api`, `app-store-connect`, `apple-search-ads`,
  `account`, `support`.
  `src/commands/` holds those directories and `registry.ts`, nothing else.
- **A command is a file at the path you type.** Its words are its path, minus
  the group's `prefix` (`asc`, `asa`, `api`): `superwall asc keys create` is
  `src/commands/app-store-connect/keys/create.ts`, `setup apple` is
  `app-store-connect/setup/apple.ts`, and the bare `asa` catalog is
  `apple-search-ads/asa.ts`. A group's `folders` gather related commands one
  level down: `asc get` is `app-store-connect/api/get.ts`, `asc products` is
  `app-store-connect/store/products.ts`. The file exports exactly one thing, `command`,
  and is listed in its group in the registry.
- **Every file has the same shape.** `defineCommand` (`src/program/command.ts`) takes
  the whole command: `name`, `summary` (upper-case, no period), `args`,
  `flags`, `examples` (each runs this command), optional `details`, `auth`
  (`none` | `optional` | `required`), `json` (takes `--json`), `prompts` (may
  ask questions), optional `channel`, and `run(ctx, { args, flags })`. Parsing,
  `--help`, the root help and the typed `args`/`flags` all come from that one
  object; nothing else describes a command.
- **Flags are declared, never read raw.** Keys are camelCase (`keyFile` is
  `--key-file`, a one-letter key is a short flag: `d` is `-d`); types are
  `string`, `number`, `boolean`, `list`. Shared ones live in `src/program/flags.ts`
  (`app`, `project`, `yes`, `dryRun`, `data`, `installDir`, `skill`, `team`):
  spread them, override `describe` when the meaning narrows. Unknown flags,
  extra arguments and bad choices are refused before `run`. A flag or
  argument with `channel: "next"` exists only on that channel; an example
  with a third `"next"` element and `summaryOn: { next }` do the same for
  help. `bare: true` lets a string flag be passed without a value (`migrate
  --screen` picks one); `verbatim: true` keeps a value untrimmed (passwords).
  `--app` and `--project` also fill `ctx.target`, which `core/account/scope.ts` reads, and
  `--dry-run` fills `ctx.dryRun`.
- **A command file is its description and nothing else.** It holds imports
  and `export const command = define…({…})`, written inline, with its keys in
  one order: `name`, `summary`, `summaryOn`, `details`, `args`, `flags`,
  `examples`, `auth`, `json`, `prompts`, `mcp`, `channel`, `run`. `run` is at most 15
  lines: it reads the input and calls core. A command's whole flow lives in
  core as `run<Command>(ctx, input)` (`runSetupApple`, `runPromote`,
  `runWhoami`), next to the domain it belongs to. Command files never import
  another command, never touch `argv`, and core never reads flags: it takes
  values as parameters.
- **Topics.** A command's leading words (`asc`, `asc keys`) are a topic in its
  group (`topics` in the registry: name, summary, details), so `superwall asc
  keys` alone lists what it holds. Help folds a topic with two or more
  commands, and a catalog with its sibling commands, into one row (`asc`,
  `asa`); a topic with one command shows the command (`setup apple`). A topic
  with `sections` lists its commands under those titles (`superwall asc`), and
  each of its commands sits in exactly one.
- **Catalogs.** A family driven by a catalog (`apps …`, `products …`, `asa
  campaigns …`) is one `defineCatalog` file with the same description fields
  plus `operations()` and `help(words)`; its flags are parsed loosely because
  they come from the live API.
- **App Store Connect resources** (`asc subscription-groups`, `asc
  subscriptions`, `asc iaps`, `asc localizations`, `asc prices`, `asc offers`,
  `asc availability`, `asc screenshots`) are catalogs written with
  `defineAscResource` (`src/core/app-store-connect/resources/define.ts`): each
  operation declares `args`, `flags` (keys are Apple's attribute names, so
  `subscriptionPeriod` is `--subscription-period`; `required` and `choices`
  feed the parser, the help and the MCP schema), its `effect`, and a `run` in
  `src/core/app-store-connect/resources/` that goes through an `AscSession`.
  The engine refuses unknown flags, missing required ones and bad choices
  (choices match case-insensitively, `-` for `_`), and prints rows or a value.
  The App Store app is `<asc-app>` on `list` and `--asc-app` on `create`, an
  id or a bundle ID; `--app` stays the Superwall app whose key signs.
  `asc submit` is a plain command over the same session. A flag may be a
  `list` (repeatable, an array in the MCP schema) and an argument may have
  `choices` (`asc release phased <action>`).
- **Releases** (`asc versions`, `asc builds`, `asc metadata`, `asc release`,
  in `src/commands/app-store-connect/release/`) are the same kind of catalog.
  A `<version>` is an App Store version id, or its version string with
  `--asc-app` and `--platform` (IOS by default), resolved by
  `resolveVersionId`. States are Apple's `appVersionState`, never the
  deprecated `appStoreState`. `asc release submit` and `asc submit` share
  `createReviewSubmission` (reuse the app's `READY_FOR_REVIEW` submission or
  open one, add items, submit): a version goes in with any
  `--subscription`/`--iap`/`--group`, because Apple reviews an app's first
  in-app products only with a version. Guards read Apple's state first and
  refuse before writing: `versions delete` only while editable, `release
  release` only from `PENDING_DEVELOPER_RELEASE`, `phased` only the
  transitions Apple allows. `release release` is `destructive` (it confirms):
  shipping to customers can't be undone.
- **Tests.** `tests/helpers/command.ts`: `runCommand(command, { args, flags,
  json, interactive, api })` calls a command directly; `runLine("asc keys
  list --app 8")` goes through the real parser. Tests mirror `src/` file for
  file.

```
src/
  entry.ts          main(): install the terminal host, run the program, flush
                    telemetry and the update check
  tools.ts          the MCP surface, exported as @superwall/cli/tools
  program/          the command system: command.ts (defineCommand,
                    defineCatalog, reading flags), host.ts (what a run needs
                    from its surroundings), lifecycle.ts (renderer, --json
                    refusal, telemetry, auth, errors), parse.ts (router),
                    help.ts (every help page), flags.ts (shared flags),
                    output.ts, run.ts (version, root help, the router)
  hosts/            the terminal: files under ~/.superwall, paths, the local
                    project, renderer selection (Node lives here)
  commands/         registry.ts + one directory per help section
  core/             the logic behind the commands, at the same path as the
                    command (core/app-store-connect/keys/ for asc keys,
                    core/main/ for apps, products, …), plus the shared layers:
                    api/ (the Superwall API client), codebase/ (the user's app
                    on disk), state/ (the store)
  ui/               the renderer, spinner.ts (withSpinner, apiCall),
                    help-layout.ts, clipboard.ts, select.ts
  environment.ts    environment variables, the version and channels
```

- Inside a directory import with `./`; everything else with `@/`. No barrels.
- Tests that span many modules (the command contract, the channel split, the
  bundle) live in `tests/contracts/`.

## One registry, two hosts (CLI and MCP)

The registry is the only definition of a command. The terminal and the MCP
server at mcp.superwall.com run the same commands; `@superwall/cli/tools`
(`src/tools.ts`) turns the registry into MCP tools, and the server imports it.

- **Every command says whether it is an MCP tool**: `mcp: "read" | "write" |
  "destructive" | false`. The first three make it a tool (it must answer
  `--json`) and set its hints; `false` keeps it to the terminal. The server's
  `instructions()` don't list those commands: they tell an agent with a shell to
  use the CLI itself, and one without to hand the user the `npx superwall`
  command for machine work. Keep that paragraph in step when a kind of
  machine-only work is added.
  Anything needing the user's machine (a project on disk, a browser, Apple
  sign-in, agents) is `false`. A catalog describes its operations with
  `tools()`; an operation that only works locally is `mcp: false`.
- **A tool is the command**: its name is the command words joined by `_`,
  its input the arguments and flags (catalog operations: positionals, `app`
  and the API's own fields from the live reference), and its result the
  command's `--json` output, through the same `execute()`. Tools run as if
  `--yes` were passed: the MCP client asks the human before a destructive
  call.
- **The host** (`program/host.ts`) is everything a run takes from its
  surroundings: the API client, renderer, stdout, file input (`readInput`),
  the local project (`detectApp`, `readLockRef`), telemetry, failure. Storage
  goes through `core/state/store.ts`: `cache` (public data: API reference,
  Apple schema) and `state` (per user: session, config). The terminal host
  (`hosts/terminal.ts`) backs both with `~/.superwall`; the MCP host keeps a
  shared in-memory cache and no user state.
- **Every tool matches its command.** `bun run test:parity` calls each case in
  `scripts/mcp-parity/*.json` twice against production with your login: the
  real CLI (`tool.cli(input)`, `--json`) and the tool through the MCP host, and
  fails unless both give the same JSON and the same success or failure. Reads
  run for real; writes only as dry runs or against ids that can't exist. Add
  cases when you add or change a tool. The only accepted difference is state the
  terminal keeps: organizations you opened by link but aren't a member of.
- **The MCP carries the public skills.** `bun run build` vendors the skills,
  then `build-tools.ts` embeds every file of every skill on `main` into
  `dist/tools.js`, except those in its `NOT_ON_MCP` denylist: work that needs a
  shell, today `superwall-framework`. A new skill on `main` reaches the MCP with
  the next release, with no change here. `listSkills()` and `readSkill(uri)`
  serve them as `skill://` resources (`superwall/SKILL.md` first), and the
  read-only `skill` tool comes first in `listTools()` for clients that don't
  read resources. Vendor before building the tools; the build fails without
  `superwall/SKILL.md`.
- **Tool code never touches Node.** `tests/contracts/mcp.test.ts` walks every
  static import from `src/tools.ts` and fails on any `node:*` or package but
  picocolors, printing the chain. A CLI-only command imports its core with
  `await import()` inside `run`; a tool's core reads files and the machine only
  through the host.

## Why it works this way

Rationale that used to sit in comments. Keep it here, next to the rules.

- **Fresh accounts lag.** Org membership and project listings take up to a
  minute to reflect a new org or app (the API caches auth context per token for
  60s), so login refreshes its token after creating an org, and `integrate`
  reuses the org and app this machine created (`readOnboardedApp`) instead of
  asking the API. A failed organizations list on a new account means "no org".
- **Login is lazy.** Local agents (Claude Code, Codex) run without a session;
  the bundled Superwall Agent needs a browser login because its hosted grant is
  per user, so an `--api-key` login can't use it. `migrate` exports the
  session's key as `SUPERWALL_API_KEY` so the agent's own CLI calls work.
- **Headless means honest.** `integrate` with no session exits 1 with a warning
  rather than 0 with a half-done setup: CI and benchmarks must see it.
  `--driver claude|codex|superwall` forces a backend; detection order is the
  priority order.
- **Skills install from a normalized clone.** `skills add` parses frontmatter
  as strict YAML and silently drops a skill whose `description:` contains `: `,
  so the CLI clones, quotes such values (`normalizeSkillFrontmatter`) and
  installs from the copy; the URL install is the fallback. Skill install never
  fails `login`. Bundled skills count as stale on any CLI version change; the
  public repo is checked by HEAD sha, at most daily, and kept as is offline.
- **Telemetry is anonymous by design**: a random persisted id, enum/boolean/
  number properties only, no person profiles, and a fetch timeout shorter than
  the exit flush so an unreachable endpoint can't hold the process open.
- **Apple keys:** the ASC proxy signs with the org's stored key, so nothing
  signs a `.p8` or JWT locally. Apple names key files `AuthKey_<KEYID>.p8`, and
  drag-and-drop escapes spaces as `"\ "`. ASC products walk subscription
  groups before in-app purchases, so the richer subscription record wins.
- **App Store Connect writes** use Apple's version-based endpoints: the v2
  localizations hang off a product's version, never the deprecated v1 ones or
  `subscriptionAvailabilities`. Apple deprecates endpoints in its docs and
  release notes (4.4, 4.4.1, 4.5) without always marking them in the OpenAPI
  spec, so `REPLACED` in `src/core/app-store-connect/api/replaced.ts`, next to
  the spec index, lists them with their replacements; `asc docs` marks them and
  the raw `asc get|post|patch|delete` warn before sending. Add a row when Apple's
  notes deprecate another one (the doc page's `deprecationSummary` names the
  replacement). A change goes to the latest version when it is
  editable (`PREPARE_FOR_SUBMISSION`, `READY_FOR_REVIEW`, `REJECTED`,
  `DEVELOPER_REJECTED`), otherwise to a new one. Subscriptions don't equalize
  their own prices: `prices set` and `subscriptions create` find the price
  point in the base territory (paging, since Apple has no price filter), read
  its equalizations and write one price per available territory in a single
  `PATCH /v1/subscriptions/{id}` with inline `included` entries; in-app
  purchases post a schedule and Apple equalizes. A dry run still sends the
  reads whose path it knows (they make the plan exact) and plans every write
  and every read that depends on one, with `${name}` placeholders for ids Apple
  would return; Apple's own inline ids use the same `${…}` form. A failed step
  names what was already created, because Apple has no transaction. The
  screenshot upload reads a local file and PUTs to Apple's signed URLs, so it
  is `mcp: false` and loads its file reader with `await import()`.
- **Detection is best-effort on purpose:** manifests miss Tuist and vendored
  SDKs, so billing detection also scans imports; a native project under a JS
  root is generated (Expo prebuild, React Native), not its own app.
- **`.superwall/*.md` reports** let a later action read what an earlier one
  found (review → implement).
- **Prompt templates:** `{{#var}}…{{/var}}` keeps the block only when `var` is
  non-empty; `{{var}}` throws when missing. The copy prompt strips `[STATUS]`
  lines, which only the headless runner understands.

## UI rules (`src/ui/`)

- Everything renders through the `ui` facade - never `console.log`. The only raw
  `process.stdout` writes are machine output: `--json` payloads and `--skill`
  markdown (those must stay clean of UI decoration).
- **Timeline never dangles.** Connectors (`│`) are a _prefix_ of each item after
  the first - never a trailing line. `outro` renders only with a message (`└ text`);
  a command whose last output is content just ends. Don't re-introduce trailing
  connectors.
- `ui.intro` first, then spinners. Never start a spinner before the intro.
- Tabular data → `ui.list` (one line per row: label, dim badge/meta). Check
  results → a `ui.report` block of aligned `✓/✗ label value` lines (see doctor).
  Multi-line `ui.step` strings are a smell.
- Big hierarchies → file-tree rendering with `├── └── │` (see `bootstrap`).
- Verify TTY rendering with `script -q /dev/null superwall <cmd>`. Piped output
  does not exercise Ink behavior.

## Skills (the product)

Read the skills repo's `AUTHORING.md` before writing or editing any skill,
and edit it there, then `bun run build`. The short version:

- Layout: lean `playbook.md` (≤ ~80 lines) + one deep file per framework
  (`ios`, `android`, `expo`, `react-native`, `flutter`) or provider (`revenuecat`,
  `adapty`, `qonversion`) beside it. The CLI composes the playbook + one
  framework/provider file (`FRAMEWORK_REF` in `src/core/workflows/agent/actions.ts`;
  placements also gets `strategy.md`) - an Expo agent must never see Swift docs.
- Every API name/version verified against live docs before it's written. Docs are
  fetchable as markdown: `curl -sL superwall.com/docs/llms.txt` (index),
  `curl -sL superwall.com/docs/{path}.md` (any page). Every skill carries a
  "Docs access" block and inline fetch commands at the steps that need them.
- **Never exaggerate.** Migration skills state plainly what does NOT migrate.
  Unverifiable claims are flagged inline ("confirm against <doc url>"), never
  invented. Craft guidance is labeled as recommended practice, not doc-cited.
- Skill installation is 100% delegated to the vercel-labs `skills` CLI
  (`npx -y skills@latest add …`): it owns locations (`~/.agents/skills` canonical
  + per-agent symlinks), agent detection, everything. We only _list_ the repo
  (GitHub API, live) for the picker and pass `--skill` filters. Never hardcode a
  skill list except as an offline fallback.

## prompts/ (harness protocol only)

`prompts/*.xml` is the runner's protocol - context injection, `[STATUS]`
streaming, guardrail commandments, report format. Templating is deliberately dumb:
`{{var}}` substitution and `{{#var}}…{{/var}}` conditional blocks; anything
smarter belongs in TypeScript. **No domain expertise in XML** - that goes in
skills. Missing variables throw; keep it that way (it catches template drift).

## Keeping everything in sync (do this EVERY surface change)

When a command is added, renamed, or removed, or its flags/output change, sweep
and update ALL of:

1. The command's spec (summary, flags, examples, details): help comes from it
2. `README.md` command examples (user-facing: runnable code blocks, no internal jargon)
3. The skills repo (its playbooks quote CLI commands constantly); rebuild to bundle them
4. `prompts/actions/*.xml` if the harness wrapper mentions commands
5. **The public skills repo** ([superwall/skills](https://github.com/superwall/skills)):
   the workflow skills this package vendors, plus `skills/superwall/`
   (`SKILL.md` workflow router table, `references/api.md` CLI reference). It
   documents this CLI; a rename here without an edit there ships lies to every
   installed agent. Skill changes and CLI releases ship together: edit there,
   `bun run skills:vendor`, commit both.

`grep -rn "superwall <old-name>"` across this package (and the skills repo, if
you have it checked out) before calling it done.
`--json` output shapes are agent contracts - don't change them casually.

## Code style

- **No comments.** Names and structure carry the meaning; a rationale that
  outlives a PR goes in this file. Never narrate what code does, never leave
  "coming soon" notes, never comment out code - delete it (git remembers). The
  only exceptions are directives (`@ts-expect-error`) and the doc comments of
  the published entries (`src/entry.ts`, `src/core/account/token.ts`).
- **Function verbs, one catalog, no synonyms:** `find*` throws when absent,
  `select*` returns `undefined` when absent, `list*`, `count*`, `create*`,
  `update*`, `upsert*`/`replace*`, `remove*`/`revoke*`, `resolve*` (derive a
  value), `read*`/`write*` (local files and caches only), `render*`/`format*`/
  `parse*`, `assert*` (throws, returns nothing), and for a CLI: `run*` (a
  command), `print*` (writes to the terminal), `pick*` (asks the user to choose),
  `download*` (a remote file). Never `get* fetch* load* set* save* delete*
  destroy*`; HTTP verbs on the API client are methods, not names. The published
  `@superwall/cli/auth` names (`getOAuthAccessToken`) stay as they are. Untyped
  JSON is read with `src/core/json.ts` (`isRecord`, `field`, `textField`,
  `listField`, `parseJson`), never a local copy.
- **Readability:** no awaited call inside a ternary (guard and return early);
  a multi-line arrow body gets a block and a `return`; short functions have no
  blank lines, longer ones separate their phases with one.
- **No silent failures:** a `catch` rethrows, returns a typed result, or is a
  documented best-effort path (cache refresh, telemetry, update check).
- **No casts.** No `as`, no non-null `!`; read flags through `src/argv.ts`,
  narrow with guards. The exception is JSON from the network or disk, decoded
  once where it enters.
- No dead code, no unused exports, no aliases kept "just in case", no
  single-use constants unless they are a tunable (timeout, limit, TTL).
- `VERSION` comes from `package.json` (single source). Anything the CLI reads
  from its surroundings — hosts, `SUPERWALL_API_KEY`, `SUPERWALL_HOME`, whether
  the terminal is interactive — lives in `src/environment.ts`; a value used in
  one place stays there.
- Branded UI color is `THEME.primary` cyan; picocolors for dim/bold (auto-safe
  for non-TTY); never raw ANSI in command code.

## Diagnostics vs errors

Project problems the CLI can describe but not fix (a component sitting in
`app/`, two files claiming one route) are **warnings in `dev` and hard errors in
`push`/`publish`** - a published version is immutable, so shipping one from a
project with known problems is not recoverable. `requireClean()` gates the
pipeline and is scoped to the *selected* surfaces, so an unrelated half-finished
paywall never blocks someone else's push. Group repeated diagnostics into one
message that lists the affected files; never emit the same sentence per file.

## Build / test / verify

- **Rebuild after every change**: `bun run build` (tsdown). The user (and you)
  test through the globally linked `superwall`/`sw` binaries which run `dist/`.
  source-only changes are invisible until rebuilt. (The repo root's
  `postinstall` builds this package once on `bun install`; after that,
  rebuilding is on you.)
- `bun run typecheck` (tsc) and `bun run test` (node's test runner via
  `tsx --test`; needs ripgrep on PATH) must be green. Tests live in `tests/`
  mirroring `src/`. **Never invoke a command handler from a test.** A handler is
  a real command: one of them logs you out, one scaffolds a project into the
  cwd and installs dependencies, one shells out to npx. Drive commands through
  `executeCommand` with the `tests/helpers/command.ts` harness, and assert
  wiring statically — `tests/contracts/commands.test.ts` is the pattern. `tests/setup.ts` points `SUPERWALL_HOME` at a temp directory
  for every run, so no test can read or write the developer's real session
  (`tests/helpers/home.ts` builds on it, never on the real `~/.superwall`).
  Under Bun, `process.exitCode = undefined` keeps a nonzero code, so tests reset
  it to 0, and hooks leak across files, so each test cleans up after itself. CI runs `bun run test:coverage`, which enforces coverage
  thresholds (98% lines, 94% branches, 96% functions) — a green `test` alone
  is not the CI gate. Every command file has a test file. Nothing real runs:
  binaries (`claude`, `codex`, `git`, `npx`) are fake scripts on `PATH`
  (`helpers/bin.ts`, `helpers/workflow.ts`), the API is a fake that refuses
  unexpected requests (`helpers/routed-api.ts`, `helpers/fetch.ts`), prompts
  answer from a script (`helpers/answers.ts`), and browsers, studio servers
  and simulators come in as injected dependencies. The coverage report's
  uncovered line numbers are wrong under tsx; run with
  `NODE_OPTIONS=--enable-source-maps` to get real ones.
- Verify behavior with the real binary against an account you are logged into
  (`superwall whoami` to confirm), not just types. For workflows, `--dry-run`
  and `--skill` are the cheap smoke paths.

## Adding a command - checklist

1. Create `src/commands/<group>/<words>.ts` (`asc keys create` →
   `app-store-connect/keys/create.ts`), with `mcp` set (its effect, or `false`
   with its core imported lazily), exporting `command =
   defineCommand({...})` (see "Commands: one system"), with its logic in
   `src/core/`. A new resource operation is a catalog entry in that resource's
   file, not a new file.
2. Add it to its group in `src/commands/registry.ts`, and a topic for any new
   leading words (and to that topic's `sections`, if it has them).
3. Run `tests/contracts/commands.test.ts`: it checks the file, the name, the
   group, the description and the help.
4. `json: true` if it outputs data.
5. Run the sync sweep (section above).
6. Typecheck, test, rebuild, run it for real (TTY + `--json` + `--no-interactive`).
