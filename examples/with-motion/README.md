# with-motion

In-page animation with [Motion](https://motion.dev) — entrances, a price that
counts up, a button that responds to touch.

```bash
superwall create --example with-motion
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

```tsx
<motion.li
  initial={{ opacity: 0, x: -12 }}
  animate={{ opacity: 1, x: 0 }}
  transition={{ delay: 0.15 + index * 0.08 }}
>
```

**Any React library just works.** `bun add motion`, import it, done — a
paywall is a React app, so there is nothing to integrate.

**Two kinds of animation, two owners.** Motion animates _inside_ a page;
moving _between_ pages stays the router's job (`router.push` with a
transition). Keeping that line means spamming navigation can never fight your
component animations.

**Animate to real data.** The price counts up to `variables.rawPrice` — a
number from the store — and only renders once it exists, so the animation can
never land on a made-up figure.

**`whileTap` earns its keep on a CTA.** A 0.98 scale on press is feedback the
whole hand notices, and it costs one prop.
