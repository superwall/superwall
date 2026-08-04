# AGENTS.md

> **This package now lives in the superwall framework monorepo** (migrated
> from the standalone superwall/cli repo). It owns no bin: the framework
> package (`packages/superwall`) declares the `superwall`/`sw` binaries, and
> its `bin/superwall.js` calls `main()` from this package's `src/entry.ts`.
> The paywall commands (`create`/`dev`/`push`/`promote`/`publish`) are
> registered in `src/cli.ts` like every other command. Never import
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

All agent-facing expertise lives in `skills/` (this package: task-specific) and
[superwall/skills](https://github.com/superwall/skills) (public skills repo, source
of truth, cloned beside this monorepo — `../skills` from the repo root).
TypeScript never contains domain expertise. If you're writing
paywall/migration/integration knowledge in a `.ts` file, stop and put it in a
skill.

## Command design

- **One name per concept. No aliases, no synonyms.** It's `apps`, not projects,
  users think "my app"; `--project` survives only as a scoping flag). It's
  `asc keys` (not secrets - ASC calls them API keys). A second name for the same
  thing is a bug.
- **Workflows are verbs users say**: `integrate`, `migrate`, `review [--fix]`.
  Every workflow takes `--skill` (print the composed playbook instead of running).
- **Resources are plural nouns** with `[action]` positionals, `list` as default:
  `products [list|create|storekit]`, `campaigns [list|create|placement]`.
  All take `--json`. Scope with `--project <id>` / `--app <id>`.
- **Raw API = bare verbs**: `get|post|patch|delete /v2/… [-d k=v]` for ours,
  `asc <verb> /v1/…` for App Store Connect. httpie-style params: `k=v` string,
  `k:=v` typed JSON, `k[sub]` nesting; on get/delete `-d` becomes query params.
- **Kill commands that don't earn their place.** A command that duplicates
  another's output (scan vs doctor) or has no user (pull/plan/push) gets deleted,
  not deprecated.
- **Help is hand-written** in `printHelp()` (`src/cli.ts`), Stripe-style grouped
  sections: Workflow / Resource / API / App Store Connect / Other. Every command
  add/remove/rename MUST update it - yargs' auto-help is never shown at the root.
- **Errors are short.** Unknown command / bad args → `✗ message` + "Run
  superwall --help for usage.", exit 1. Never dump the full help on failure
  (`showHelpOnFail(false)` + the `.fail()` handler).

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

Read `.claude/skills/authoring-skills/SKILL.md` before writing or editing any
skill. The short version:

- Layout: lean `SKILL.md` router (≤ ~80 lines) + deep `references/<x>.md` per
  framework (`ios`, `expo`, `react-native`, `flutter`) or provider (`revenuecat`,
  `adapty`, `qonversion`). The CLI composes SKILL.md + exactly ONE reference
  (`FRAMEWORK_REF` in `src/core/agent/actions.ts`) - an Expo agent must never see
  Swift docs.
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

1. `printHelp()` in `src/cli.ts`
2. `README.md` command examples (user-facing: runnable code blocks, no internal jargon)
3. This package's `skills/**/*.md` (bundled skills reference CLI commands constantly)
4. `prompts/actions/*.xml` if the harness wrapper mentions commands
5. **The public skills repo** ([superwall/skills](https://github.com/superwall/skills),
   `skills/superwall/` in your local clone) - `SKILL.md` (workflow router
   table) and `references/api.md` (the CLI reference). It documents this
   CLI; a rename here without an edit there ships lies to every installed agent.

`grep -rn "superwall <old-name>"` across this package and the skills clone
before calling it done.
`--json` output shapes are agent contracts - don't change them casually.

## Code style

- **Write no comments.** Rationale — the workaround, the API quirk, the timing
  gotcha — belongs in the PR description, where reviewers read it and it can't
  rot beside code that moved on. Never narrate what code does, never leave
  "coming soon" notes, never comment out code - delete it (git remembers).
  Leave existing comments alone unless you are changing the code they sit on.
- No dead code, no unused exports, no aliases kept "just in case".
- `VERSION` comes from `package.json` (single source). Constants live in
  `src/constants.ts` only if used in 2+ places.
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
  mirroring `src/`. CI runs `bun run test:coverage`, which enforces coverage
  thresholds — a green `test` alone is not the CI gate.
- Verify behavior with the real binary against the logged-in dev account
  (`superwall whoami` to confirm), not just types. For workflows, `--dry-run`
  and `--skill` are the cheap smoke paths.

## Adding a command - checklist

1. Handler in `src/commands/<category>/<name>.ts` (categories: `paywalls`,
   `workflow`, `resource`, `platform`, `account`) using `defineCommand`
   (lifecycle, renderer, error handling come free). Lazy-import it in `cli.ts`.
2. Register in `cli.ts` with describe + options; respect the naming rules above.
3. Add to the right `printHelp()` section.
4. `--json` support if it outputs data.
5. Run the sync sweep (section above).
6. Typecheck, test, rebuild, run it for real (TTY + `--json` + `--no-interactive`).
