# abandonment-offer

Catch the people who nearly bought.

```bash
superwall create abandonment-offer
cd abandonment-offer && bun install && bun dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**`transaction_abandon` is the most valuable event on a paywall.** Most people
who open a store sheet close it:

```tsx
useSuperwallEvent("transaction_abandon", () =>
  router.push("offer", { transition: "sheet" }));
```

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
  --dim: 0.85; /* the page dims to this, and the scrim fills the difference */
  --scrim: #000;
}
```

One number drives both. The scrim is the page colour already multiplied by it —
the same operation `brightness()` performs — on the framework's own duration and
curve, so the two darken in step instead of drifting apart mid-movement.

**One offer, not two.** Abandoning the discount as well leaves them where they
are — a second sheet would be nagging.

**A second product, not a second design.** The offer route sells `discount`
while the first sells `annual` — both declared in `config.ts`.
