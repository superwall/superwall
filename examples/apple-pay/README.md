# apple-pay

Apple Pay on the web: three Stripe plans, a promo code, and a sheet that opens
on the first tap.

```bash
superwall create --example apple-pay
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at Stripe products
in your Superwall dashboard — that is the only place product data comes from,
so until they match, the studio says which are missing, every price renders
undefined, and publishing stays disabled.

Web identifiers carry the Stripe price inside them,
`{environment}:{priceId}:{offer}` — the offer suffix is Superwall's, so one
Stripe price is sold here three ways: `3days-free`, `intro_349_3days` and
`no-trial`.

## What this shows

```ts
checkout: { mode: "applePay", prefetch: "trial" },
```

**One key goes straight to Apple Pay.** Where the device offers it the native
Apple Pay sheet opens; everywhere else Stripe's in-page sheet does. `prefetch`
warms the session before the tap, so the wallet opens with nothing to wait
for. `purchase(selected)` is the same call a native paywall makes.

**Trials are quoted to Apple.** A free trial or a paid intro offer is sent as a
recurring payment with a trial line, so the sheet reads "3-Day Free Trial" and
names the price that follows it.

**A promo code re-prices the paywall.** `useDiscount().redeem(code)` validates
a Stripe promotion code and `getDiscountedProduct(reference)` hands back the
old and new price per plan, so the rows show a strikethrough and the sheet
charges the discounted amount. `onDropped` fires if the code stops being
valid, and `redeem` resolves with a reason the catalog turns into one line.

**Discount copy is assembled, not shipped.** The hook returns parts —
`percentOff`, `duration`, `durationInMonths` — never a sentence, so "15% off
forever" is built from this paywall's own messages and translates with it.

**`purchase()` resolves with the outcome.** `completed` gets a success haptic,
`failed` one line of copy with the button still enabled, `abandoned` nothing.
`restore()` is awaited and both outcomes get copy.

## Next

- [`web-funnel`](../web-funnel) — the in-page sheet, prefetch per selection, answers in the URL
- [`product-selection`](../product-selection) — plan rows on a native paywall
