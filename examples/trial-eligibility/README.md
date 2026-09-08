# trial-eligibility

Two paywalls in one, chosen by the store.

```bash
superwall create --example trial-eligibility
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**The store decides who gets a trial, not you.**

```tsx
const { eligible } = useIntroductoryOffer();
```

**The length comes from the product:**

```tsx
product.variables.trialPeriodDays;
```

**Both states have to be good.** A returning customer sees the second one, and
it cannot read like a mistake. Toggle Trial in the footer to check them side by
side.

## Next

- [`trial-reminders`](../trial-reminders) — telling them before the trial ends
- [`abandonment-offer`](../abandonment-offer) — a second chance when they decline
