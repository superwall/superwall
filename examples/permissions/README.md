# permissions

Ask the app, and wait for its answer.

```bash
superwall create permissions
cd permissions && bun install && bun dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

```tsx
const status = await requestPermission("notification");
const result = await requestCallback("checkAccount");
```

**Both resolve from the app, not the paywall.** You are waiting on code you do
not control, so show something while it runs.

**Handle a no.** A denied permission is an ordinary outcome, not an error —
`requestCallback` also carries data back when the app has some.
