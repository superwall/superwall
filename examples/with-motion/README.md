# with-motion

In-page animation with [Motion](https://motion.dev) — entrances gated on the
paywall opening, and a price that counts up to the store's figure.

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
const opened = useSuperwallSnapshot().paywall !== undefined;

<motion.li
  initial={{ opacity: 0, transform: "translateX(-12px)" }}
  animate={opened ? { opacity: 1, transform: "translateX(0px)" } : { opacity: 0, transform: "translateX(-12px)" }}
  transition={{ delay: 0.1 + index * 0.05, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
>;
```

**Gate the entrance on the paywall opening, not on mount.** The SDK preloads
paywalls in a hidden webview, so mount can happen long before anyone is
looking — a mount-timed animation has already finished playing to nobody by
the time the paywall is presented. `snapshot.paywall` is set when
`paywall_open` arrives, and unlike an event subscription it cannot be missed.

**Any React library just works.** `bun add motion`, import it, done — a
paywall is a React app, so there is nothing to integrate.

**Two kinds of animation, two owners.** Motion animates _inside_ a page;
moving _between_ pages stays the router's job (`router.push` with a
transition). Keeping that line means spamming navigation can never fight your
component animations.

**Animate the `transform` string, not `x` / `y`.** A string transform is
handed to the compositor; the shorthands are composed on the main thread,
which is busy pricing products and loading fonts exactly while the entrance
plays. Rows follow 50ms apart on the same ease-out curve the stylesheet uses,
once, 300–450ms. Under `prefers-reduced-motion` (`useReducedMotion`) the
same entrance becomes a cross-fade: nothing travels, the opacity still
explains what appeared.

**Animate to real data.** The price counts up to `variables.rawPrice` — a
number from the store — formatted in the store's `currencyCode` and `locale`
while it moves, in `tabular-nums` so the digits hold still, and lands on the
store's own `price` string. It only renders once both exist, so the animation
can never land on a made-up figure.

**Press feedback is CSS, not Motion.** The CTA's `:active` scale comes from the
stylesheet (80ms in, 200ms out) like every other control on the page; one
owner for the press, and a transition that runs off the main thread. Motion
is reserved for what CSS cannot do: the gated stagger and the count-up.

## Next

- [`with-rive`](../with-rive) — animation authored in a file rather than in code
- [`transitions`](../transitions) — the movement between pages, which is not yours
