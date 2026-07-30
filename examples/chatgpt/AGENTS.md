# AGENTS.md

This directory **is** a superwall project — not an app repo with one inside it.
That is the point: copy it into a real app as `superwall/`, or clone it as a
dedicated repo, and it works either way. It also keeps the bare-repo-root
discovery path exercised, since here the project is the repo.

- `package.json` — the project owns its npm world: the framework, react, and
  react-dom are installed here, so `install` then `superwall dev` is all a
  clone needs. Depending on `superwall` is also what marks this directory as a
  superwall project — there is no project-level config file
- `components/` — the shared design system every surface can import (aliased
  as `@/components/...`); surfaces may also keep their own
- `messages/<locale>.ts` — shared strings, inherited by every surface; surfaces
  may also keep their own
- `assets/` — shared images and fonts; surfaces may also keep their own
- `paywalls/<id>/` — each paywall is a mini React app: a required `config.ts`
  (products, experiment variables, preview overrides) + an `app/` route tree
  (just `index.tsx` here; see `examples/onboarding` for a multi-route flow with
  a layout) + local `components/`, `messages/`, and `assets/`. The
  config is the whole truth for that paywall; nothing is inherited from above
- `funnels/<id>/` — same shape for onboarding/web funnels
- `superwall.lock` — the binding map (surface → paywall ID). Commit it.

`bun dev` (→ `superwall dev`) serves every surface at http://localhost:6100
against a simulated SDK host. There is no vite config, no index.html, and no
build tooling here — the framework owns all of that; never add any.

Every import must resolve inside this directory or from a package in
`package.json`. Anything reaching outside still builds locally, but the push
records it as non-portable and remote editing turns off.
