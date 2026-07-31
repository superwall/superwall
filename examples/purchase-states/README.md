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
