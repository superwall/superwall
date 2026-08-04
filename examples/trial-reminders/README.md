# trial-reminders

Remind them before the trial ends.

```bash
superwall create --example trial-reminders
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

```ts
definePaywall({
  notifications: {
    trialReminder: { title: "…", body: "…", beforeTrialEndDays: 1 },
  },
});
```

**Scheduled by the SDK when the trial starts**, not by the paywall. It fires
long after this page has gone.

**Or compute it** — `trialReminder` also takes a function, given the trial end
date, the product and `t()` for the active locale.

## Next

- [`web-funnel`](../web-funnel) — the same purchase, taken on the web
- [`localization`](../localization) — the `t()` the reminder is written against
