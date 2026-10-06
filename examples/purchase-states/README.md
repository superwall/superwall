# purchase-states

Get the outcome of a purchase and act on it.

```bash
superwall create --example purchase-states
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**`purchase()` resolves with the outcome of that call.**

```tsx
const result = await purchase("annual");
result.status; // "completed" | "abandoned" | "failed"
```

Each outcome gets exactly one reaction: `completed` is a success haptic (the
SDK dismisses), `failed` is a notice from the catalog with the button left
enabled, `abandoned` is nothing. The button never shows a loading state — the
store sheet is the feedback. `restore()` is awaited the same way; its `failed`
covers both "nothing to restore" and a store error, so the copy says both.

**Events fire for anything the SDK reports**, whoever started it:

```tsx
useSuperwallEvent("transaction_complete", () => …);
useSuperwallEvent("transaction_abandon", () => …);
useSuperwallEvent("freeTrial_start", () => …);
```

A successful restore arrives as `transaction_complete` with no purchase in
sight — which is why both paths exist.

**Abandoned is normal.** Most people who open a store sheet close it, so treat
it as an outcome rather than an error.

## Next

- [`abandonment-offer`](../abandonment-offer) — doing something about abandoned
- [`trial-eligibility`](../trial-eligibility) — the state before the purchase
