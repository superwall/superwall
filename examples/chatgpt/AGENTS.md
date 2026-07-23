# AGENTS.md

This is an example app repo showing how Superwall integrates: everything
paywall-related lives in the `superwall/` directory —

- `superwall/config.ts` — app-level defaults
- `superwall/components/` — the shared design system every surface can import
  (aliased as `@/components/...`)
- `superwall/messages/<locale>.ts` — shared strings, inherited by every surface
- `superwall/paywalls/<id>/` — each paywall is a mini React app:
  `config.ts` (products, experiment variables, preview overrides) +
  `app/page.tsx` file-based routing + local `components/` and `messages/`
- `superwall/funnels/<id>/` — same shape for onboarding/web funnels

`bun dev` (→ `superwall dev`) serves every surface at http://localhost:6100
against a simulated SDK host. There is no vite config, no index.html, and no
build tooling here — the framework owns all of that; never add any.
