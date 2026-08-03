# web-funnel

A funnel that sells on the web: a few steps, then payment taken in the page.

```bash
superwall create --example web-funnel
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at Stripe products
in your Superwall dashboard — that is the only place product data comes from,
so until they match, the studio says which are missing, every price renders
undefined, and publishing stays disabled.

Web identifiers carry the Stripe price inside them,
`{environment}:{priceId}:{offer}` — so `live:price_1234:7days-free`. There is
no separate mapping to maintain.

## What this shows

```ts
export default definePaywall({
  checkout: "sheet",
  products: { annual: "live:price_1234:no-trial" },
});
```

**One key turns a paywall into a web checkout.** `sheet` takes payment in the
page: Superwall opens a Stripe checkout session and renders it over this
funnel, so nobody leaves mid-flow. `external` sends them to Superwall's hosted
page instead, and `applePay` goes straight to Apple Pay where the device
offers it.

**Only paid modes cost bytes.** `sheet` and `applePay` carry Stripe's payment
UI into the snapshot; `external` and native paywalls carry none of it. Stripe
itself is always fetched from Stripe, never bundled.

**The sheet is not yours to style,** and that is the point. It keeps the same
appearance on every Superwall paywall, because payment UI that borrows a
page's fonts and colors stops looking like payment UI.

**A funnel is one paywall, not several.** Every step here is a route in the
same document — `router.push("goal")` — so there is no page load between
them, nothing to re-fetch, and the whole flow ships as a single snapshot.

**The same source runs natively.** Drop `checkout` and this paywall buys
through the App Store instead; `purchase()` does not change.
