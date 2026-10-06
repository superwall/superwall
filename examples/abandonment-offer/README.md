# abandonment-offer

Catch the people who nearly bought.

```bash
superwall create --example abandonment-offer
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**Abandonment is the most valuable outcome on a paywall.** Most people who open
a store sheet close it, and `purchase()` tells you directly:

```tsx
const result = await purchase("annual");
if (result.status === "abandoned") {
  router.push("offer", { transition: "sheet" });
}
```

No event listener, no flag to work out whether this decline was the first —
only the paywall that made the offer can react to it.

**Pushed, so dismissing it is a real back** — the sheet slides down the way it
came rather than animating something new over the top.

**It arrives as a sheet**, a transition this project defines in CSS — the offer
travels up from the bottom while the page behind scales back and dims:

```css
[data-sw-transition="sheet"][data-sw-phase="enter"] {
  animation-name: sheet-enter;
}

@keyframes sheet-enter {
  from { transform: var(--sw-from-transform, translateY(100%)); }
}
```

Naming a transition is all it takes to have one.

**The scrim is yours.** The page scales away from the edges, so something has to
sit behind it — a dim over the routes layer rather than a recolour of it, since
that layer is what every page paints on:

```css
:root {
  --dim: 0.45; /* the scrim's share of ink, and how far the page behind lets it through */
}
```

One number drives both. The scrim is ink mixed over the page colour at `--dim`;
the page behind drops to `1 - --dim` opacity, so it shows the same scrim through
itself and lands on the same shade as the gap around it — transform and opacity
only, nothing filtered. Both run on the framework's own duration and curve, so
they darken in step instead of drifting apart mid-movement.

**One offer, not two.** Abandoning the discount as well leaves them where they
are — a second sheet would be nagging.

**A second product, not a second design.** The offer route sells `discount`
while the first sells `annual` — both declared in `config.ts`.

## Next

- [`transitions`](../transitions) — the system the sheet above is written against
- [`trial-reminders`](../trial-reminders) — reaching them after the paywall closes
