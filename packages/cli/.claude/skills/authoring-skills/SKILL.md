---
name: authoring-skills
description: How to write, edit, and keep in sync the Superwall agent skills — the bundled workflow skills in this repo's skills/ directory and the public superwall/skills toolkit. Use whenever creating a new skill, editing a SKILL.md or references/*.md file, adding a framework/provider reference, or when a CLI change requires updating skill content.
---

# Authoring Superwall skills

Skills are the product. The CLI is a harness that composes and delivers them.
Every rule here exists because an agent will execute this content verbatim inside
a user's codebase — wrong content ships wrong code to real apps.

## Where a skill lives

| Kind                          | Home                                                                              | Examples                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Task-specific workflow skills | this repo, `skills/`                                                              | superwall-integrate, superwall-migrate, superwall-placements, superwall-dashboard |
| Broad toolkit skills          | [superwall/skills](https://github.com/superwall/skills) (local clone `../skills`) | superwall (main/router), superwall-editor, wwdc                                   |

The public repo is the source of truth for the toolkit and the default install
path (`superwall skills` → `npx skills@latest add superwall/skills`). Task skills
stay here because they're too narrow for the main repo.

## Structure

```
skills/superwall-<task>/
  SKILL.md            lean router, ≤ ~80 lines
  references/
    <framework>.md    ios · expo · react-native · flutter   (or provider:
    <provider>.md     revenuecat · adapty · qonversion)
```

- **SKILL.md** = frontmatter (`name`, `description` written as a strong
  when-to-use), principles, the flow, a table routing to references, the CLI
  commands the agent will need, and a Docs access block. No deep content here.
- **references/** = the depth. One file per framework/provider so composition
  stays isolated: the CLI inlines SKILL.md + exactly ONE reference
  (`FRAMEWORK_REF` / provider mapping in `src/core/agent/actions.ts`). An Expo
  agent must never see `.pbxproj` instructions.
- Reference file names ARE the contract: they must match `Integration` enum
  values (`ios` for swift, `expo`, `react-native`, `flutter`) or provider slugs.
  Renaming a file breaks `loadBundledSkill(id, reference)` silently (missing
  references degrade to SKILL.md-only).

## Reference file anatomy (in order)

1. One-line context ("You are integrating Superwall into a <X> app.")
2. Lifecycle **checklist** (markdown checkboxes)
3. **Docs access block** — docs are fetchable as markdown, always include:
   ```bash
   curl -sL https://superwall.com/docs/llms.txt          # index — find the path
   curl -sL https://superwall.com/docs/{path}.md         # any page as markdown
   ```
   Plus per-SDK indexes (`/docs/{sdk}/llms.txt`) and `llms-full.txt` for breadth.
4. The steps — baked, verified instructions AND the inline `curl -sL` fetch for
   each step's doc page (baked = fast/offline; fetch = source of truth).
5. Decision points as explicit branches (e.g. purchase controller: default /
   RevenueCat / custom, with the manual-subscriptionStatus callout).
6. Verify section (build commands, what success looks like).
7. Pitfalls — real ones with fixes, not filler.
8. Deeper docs — the exact URLs used + the relevant llms.txt index.

Use `> **Important:**` callouts for critical steps; "Use when:" phrasing;
`→ references/x.md` arrows for routing.

## Content rules (non-negotiable)

- **Verify every API against live docs before writing it.** Package ids,
  version bounds, function signatures, config keys — fetched, not remembered.
  If a doc is ambiguous or version-variant, write the step and add "confirm
  against <exact doc url>". Never invent sample code for a path that has no
  official doc — write a clearly-labeled skeleton and point at the authoritative
  page.
- **Never exaggerate.** Migration skills carry a prominent "What does NOT
  migrate" callout (paywall designs rebuilt in the editor; analytics history
  stays; Adapty/Qonversion subscriber state cannot migrate — store-side restore
  only; RevenueCat subscription migration is _coming soon_, labeled "not shipped
  yet — do not rely on it").
- **Label craft vs doc-stated.** Strategy guidance (where placements go, how
  many, naming) is written imperatively but introduced as recommended practice,
  not passed off as documentation.
- Dashboard-side changes always go through the CLI (`superwall entitlements
create …`, `campaigns placement …`, `--json` everywhere) — never raw curl in
  skill steps when a CLI command exists.
- Agents following the CLI's headless runner see `[STATUS]` protocol from
  `prompts/`, not from skills — don't put harness protocol in skill content.

## The description frontmatter

It's the trigger. Write it as when-to-use: what the skill does + the situations
that should activate it + what it is NOT for (e.g. integrate: "NOT for adding
paywall triggers (that is the superwall-placements skill)").

## Keeping skills in sync

Skills reference CLI commands constantly, and the public repo's `superwall`
skill documents this CLI's entire surface. On ANY command surface change:

```bash
grep -rn "superwall <old>" skills prompts README.md ../skills/skills/superwall
```

…and fix every hit, in both repos. Also update:

- `src/core/agent/actions.ts` if action vars / references changed
- `prompts/actions/*.xml` wrappers if the task shape changed
- `superwall <cmd> --skill` smoke test: run it in a fixture project and check
  the composition (right reference, no cross-framework leakage, no unresolved
  `{{vars}}`).

## Quality bar before calling a skill done

- [ ] An agent with ONLY SKILL.md + one reference in context could execute
      flawlessly — no missing steps, no assumed context.
- [ ] Zero unverified API names (or each flagged with its doc URL).
- [ ] Composition tested: `superwall <workflow> --skill` in a fixture app of
      each affected framework; grep for leakage from other frameworks.
- [ ] Honesty pass: nothing promises more than the product does.
- [ ] Sync sweep run across both repos.
