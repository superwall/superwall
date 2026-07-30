# multi-page

Three screens in one paywall, with chrome that survives every one of them.

```bash
superwall create multi-page
cd multi-page && bun install && bun dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**Every `.tsx` in `app/` is a route.** `index.tsx`, `features.tsx`,
`plans.tsx` — the filename is the route name. No config, no registry.

**`layout.tsx` is the one reserved name.** It receives every route as
`children`, so the step counter, the back button and the footer are written
once and cannot drift between screens.

**`useRouter()` is the whole navigation API.**

```tsx
router.push("features"); // forward
router.back(); // one step
router.canGoBack(); // is there anywhere to go
router.depth; // how deep we are
router.dismissAll(); // straight back to the first screen
```

**It is a stack, not a flow.** Routes are names, not paths, and there is no
declared order — a screen can push anywhere, which is what makes branching
possible.

**No network between screens.** All three ship in one snapshot, so moving
between them is instant even offline.

## Next

- [`transitions`](../transitions) — choosing how each screen arrives
- [`localization`](../localization) — the same paywall in four languages
