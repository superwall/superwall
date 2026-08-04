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
  checkout: { mode: "sheet", prefetch: "monthly" },
  products: {
    monthly: "test:price_YOUR_MONTHLY_PRICE:no-trial",
    pro: "test:price_YOUR_PRO_PRICE:no-trial",
  },
});
```

**One key turns a paywall into a web checkout.** The three modes are
`external`, `sheet` and `applePay`. `sheet` takes payment in the page:
Superwall opens a Stripe checkout session and renders it over this funnel, so
nobody leaves mid-flow. `external` sends them to Superwall's hosted page
instead, and `applePay` goes straight to Apple Pay where the device offers it.

**Prefetch decides how fast the sheet opens.** A checkout session takes a round
trip to create, so `prefetch: "monthly"` warms that product's session up front
and the sheet opens instantly instead of after a spinner. Where the plan is
chosen on screen, warm the one in front of the person instead:
`usePurchase().prefetch(reference)` — `app/plan.tsx` calls it on every
selection change. `prefetch: false` turns the warming off.

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

## Next

- [`onboarding-quiz`](../onboarding-quiz) — steps that branch on the answers
- [`personalization`](../personalization) — what the host knows about who is looking
