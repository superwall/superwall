---
name: superwall-paywall-migrate
description: Rebuild a paywall made in Superwall's visual editor as a framework (code) paywall inside an already-scaffolded superwall/ project. Use when a paywalls/<id>/MIGRATION.md brief exists — written by `superwall create --from` or `superwall migrate <paywall-id>` — and the pages under app/ are still the starter. Not for provider migrations (superwall-migrate) or for building a paywall from a design (superwall-framework).
---

# Rebuild a dashboard paywall as code

You are inside a `superwall/` project. One surface, `paywalls/<slug>/`, was
scaffolded from a dashboard paywall: its `config.ts` is final, its
`MIGRATION.md` is your brief, and everything under `app/` is a starter to
replace. Rebuild the paywall so it looks and behaves like the source,
written the way the framework is meant to be used.

The `superwall-framework` skill is installed beside this one. Read its
`SKILL.md`, then `references/migrate-from-editor.md` (the element, action
and state mapping), `references/layout.md` (insets, positioning, scrolling)
and `references/mobile-design.md` before writing a line. This file only
fixes the order of work and the boundaries.

## Docs access

```bash
curl -sL https://superwall.com/docs/framework/llms.txt      # page index
curl -sL https://superwall.com/docs/framework/{page}.md      # one page
```

## Order of work

- [ ] Read `MIGRATION.md`; fetch the served document from its URL
      (`curl -sL -A "Mozilla/5.0" <url> -o source.html`, in a temp dir, never
      inside the project) and parse the editor store from
      `<script id="vike_pageContext">`. Confirm the brief's inventory against
      it: pages (children of the `navigation` node, in `index` order),
      drawers, every tap action, every `{{ }}` product variable, every
      `paywall_language`, every asset URL, every custom `state:state.*`.
- [ ] Design tokens: take colors, type, spacing and radii from the rendered
      HTML's inline styles and the `style_variable_group` records into
      `:root` / `:root.dark` variables in `app/theme.css`. Keep
      `--sw-background: var(--bg)`.
- [ ] One route per page under `app/`, `index.tsx` first; shared chrome the
      editor drew outside the navigation goes in `layout.tsx`. Every action
      becomes the hook call the mapping table names; `navigate-page` becomes
      `useRouter().push/back`; a drawer becomes a route pushed with the
      `sheet` transition or local state. Product text comes from
      `useProducts()` variables, guarded, with the unpriced state designed.
- [ ] Every state: both trial-eligibility variants, every selected product,
      every toggle, the drawer open and closed. Every string through
      messages, even for one language: the default copy in
      `messages/en.ts`, each source locale as `messages/<locale>.ts`, and
      `t()` in the pages (`aria-label`s included); product variables as
      guarded `t()` interpolations, never a price in a catalog. Assets
      downloaded into `assets/` and referenced relatively; fonts subset.
- [ ] Layout rules from `layout.md`: the framework insets the paywall; no
      `env()`, no `position: fixed`, chrome absolute in the layout, a pinned
      CTA sticky in the page, shell `flex: 1 1 auto`, nothing `100dvh`.
- [ ] `bun run typecheck` in the project passes. Fix every diagnostic
      `superwall dev` would print (a stray file in `app/`, a duplicate
      route).
- [ ] Leave `MIGRATION.md` in place; the user deletes it after review.

## Boundaries

- Never run `superwall push`, `promote` or `publish`, and never touch
  campaigns. The user reviews in the studio (Compare › Original) and ships.
- Never change `config.ts` except to replace a `"missing"` product
  identifier the user has named. Never invent a product or a price.
- Never paste the editor's generated HTML or CSS. Rebuild the design with
  clean components; the Compare pane decides when it matches.
- Anything with no framework equivalent (surveys, `teleport-to-web`) is
  listed in your final note as not carried over, never approximated.
