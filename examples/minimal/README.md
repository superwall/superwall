# minimal

The smallest paywall that is still a real one: a headline, a price, a purchase
and a restore.

```bash
superwall create --example minimal
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**A paywall is a React app.** `app/index.tsx` is a component. There is no
template, no schema, no editor — you write JSX and it ships.

**Prices come from the SDK.** `getProduct("monthly")` returns store data at
runtime, so the paywall shows the right currency in every country without
knowing anything at build time.

```tsx
monthly?.variables.price; // "$9.99"
```

Nothing is hardcoded, so a missing product renders nothing rather than a lie.

**The button never enters a loading state.** The store sheet is the feedback
and the SDK owns it — a native paywall does not grey its own button out.
`usePurchase()` exposes `isPurchasing` for the cases that genuinely need it; a
buy button is not one of them.

**`restore()` is fire-and-forget.** There is no restore-result event; a
successful restore surfaces as `transaction_complete` or a dismissed paywall.

## Next

- [`product-selection`](../product-selection) — two plans and a choice
- [`multi-page`](../multi-page) — more than one screen
