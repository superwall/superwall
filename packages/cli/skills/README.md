# Skills

The agent skills that ship inside `@superwall/cli`. Each is a self-contained
playbook — a lean `SKILL.md` router plus deep `references/` — that the CLI
composes for the user's platform and hands to their coding agent (Claude Code
or Codex). They follow the [agent skills](https://agentskills.io) format, so
they also install directly into any agent with `npx skills add`.

| Skill                                        | What it does                                                                           | References                                | Driven by                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------ |
| [`superwall-integrate`](superwall-integrate) | Install and configure the SDK in an app for the first time                             | `ios` `expo` `react-native` `flutter`     | `superwall integrate`                |
| [`superwall-placements`](superwall-placements) | Add or audit placements at feature gates and route them to campaigns                 | `strategy` + one framework                | `superwall integrate` (phase 2)      |
| [`superwall-dashboard`](superwall-dashboard) | Create the entitlements, products, and campaigns a placement needs to present          | `setup`                                   | `superwall integrate` (phase 3)      |
| [`superwall-review`](superwall-review)       | Audit an existing setup end to end; `--fix` repairs verified findings                  | `ios` `expo` `react-native` `flutter`     | `superwall review [--fix]`           |
| [`superwall-migrate`](superwall-migrate)     | Move an app off RevenueCat, Adapty, or Qonversion                                      | `revenuecat` `adapty` `qonversion`        | `superwall migrate`                  |
| [`superwall-paywall-migrate`](superwall-paywall-migrate) | Rebuild a dashboard (visual editor) paywall as a framework paywall from its `MIGRATION.md` brief; leans on the installed `superwall-framework` skill for the mapping and layout rules | none | `superwall migrate <paywall-id>`, `superwall create --from` |

The broad toolkit skills — `superwall` (resources, analytics SQL, docs, SDK
triage) and `superwall-editor` (build paywalls in the visual editor from the
CLI) — live in the public [superwall/skills](https://github.com/superwall/skills)
repo. `superwall login` installs them into your agent and `superwall skills`
keeps them updated. Building paywalls and funnels as code is the framework's
job: see the [root README](../../../README.md) and `superwall create`.

## How a skill reaches the agent

- **Composed at run time.** `loadBundledSkill(id, reference)` in
  `src/core/agent/skills.ts` joins `SKILL.md` with exactly the references the
  detected app needs (`FRAMEWORK_REF` in `src/core/agent/actions.ts`;
  placements always adds `strategy`). An Expo agent never sees Swift docs.
  Frontmatter is stripped; a missing reference file is a hard error.
- **Wrapped by the harness.** `prompts/actions/<action>.xml` adds the task
  framing and `[STATUS]` protocol; `prompts/commandments.xml` the guardrails.
  Harness protocol lives there, never in a skill.
- **Or printed.** `superwall integrate|migrate|review --skill` writes the
  composed playbook to stdout for an agent you drive yourself. `integrate
  --skill` is all three phases (integrate → placements → dashboard) in order.
- **Or installed.** `superwall skills` delegates to the `skills` CLI
  (`npx -y skills@latest add …`), which owns locations and agent detection.

## Layout

```
skills/superwall-<task>/
  SKILL.md              router, ≤ ~80 lines: when to use, principles, the
                        flow, a table routing to references, the CLI commands
                        the agent will need, a Docs access block
  references/<x>.md     the depth — one file per framework or provider
```

- Reference file names are the contract: they match `Integration` values
  (`ios` for swift, `expo`, `react-native`, `flutter`) or provider slugs.
- `SKILL.md` frontmatter is `name` (equal to the directory) and `description`
  written as when-to-use: what the skill does, the situations that activate
  it, and what it is **not** for (pointing at the sibling skill).

### Reference file anatomy, in order

1. One-line context ("You are integrating Superwall into a <X> app.")
2. Lifecycle checklist (markdown checkboxes)
3. Docs access block — always include:
   ```bash
   curl -sL https://superwall.com/docs/llms.txt          # index — find the path
   curl -sL https://superwall.com/docs/{path}.md         # any page as markdown
   ```
4. The steps — verified instructions plus the inline `curl -sL` for each
   step's doc page (baked = fast and offline; fetched = source of truth)
5. Decision points as explicit branches
6. Verify section — build commands, what success looks like
7. Pitfalls — real ones with fixes
8. Deeper docs — the exact URLs used

`> **Important:**` callouts for critical steps; `→ references/x.md` arrows for
routing.

## Content rules

- **Verify every API against live docs before writing it.** Package ids,
  version bounds, signatures, config keys — fetched, not remembered. If a doc
  is ambiguous, write the step and add "confirm against <exact doc url>".
  Never invent sample code for a path with no official doc.
- **Never exaggerate.** Migration skills carry a prominent "what does NOT
  migrate" callout. Paywall designs are rebuilt — as code with the framework
  or in the editor — and the skill says so. Craft guidance (where placements
  go, how many, naming) is introduced as recommended practice, not passed off
  as documentation.
- **Dashboard changes go through the CLI** (`superwall entitlements create …`,
  `campaigns placement …`, `--json` everywhere) — never raw curl when a
  command exists.
- **No harness protocol in skills.** `[STATUS]` lines and report formats come
  from `prompts/`.
- **No customer specifics.** Placeholders are `pk_YOUR_PUBLIC_KEY`,
  `AuthKey_<KEY_ID>.p8`, `<campaignId>`; pitfalls are written generically.

## Keeping skills in sync

Skills quote CLI commands constantly, and the public `superwall` skill
documents this CLI's whole surface. On any command change, sweep:

```bash
cd packages/cli && grep -rn "superwall <old>" skills prompts README.md
```

then `src/core/agent/actions.ts` (action vars, references),
`prompts/actions/*.xml` (task wrappers), and the `superwall` skill in
[superwall/skills](https://github.com/superwall/skills). Smoke the
composition with `superwall <workflow> --skill` in a fixture project of each
affected framework: right reference, no cross-framework leakage, no unresolved
`{{vars}}`.

## Before calling a skill done

- [ ] An agent with only `SKILL.md` + one reference in context could execute it
      flawlessly — no missing steps, no assumed context.
- [ ] Zero unverified API names, or each flagged with its doc URL.
- [ ] Composition tested per framework; grep for leakage.
- [ ] Honesty pass: nothing promises more than the product does.
- [ ] `bun run test` — `tests/core/agent/skill-contracts.test.ts` checks the
      files the loader expects exist.
