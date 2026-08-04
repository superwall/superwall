# onboarding-quiz

Answers that decide where you land.

```bash
superwall create --example onboarding-quiz
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**Routes are names, not a sequence.** Any screen can push any other, which is
what makes branching possible at all.

**The router carries no state.** Answers live outside React because a later
screen reads them after the one that collected them has unmounted — a store or
a context would do the same job:

```ts
export const answers: { goal?: Goal; level?: Level; time?: Time } = {};
```

**`dismissAll()` returns to the first screen** without unwinding one at a
time.

## Next

- [`purchase-states`](../purchase-states) — what happens after the last screen
- [`web-funnel`](../web-funnel) — the same idea of steps, selling on the web
