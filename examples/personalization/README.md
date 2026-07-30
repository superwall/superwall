# personalization

What the SDK knows about who is looking.

```bash
superwall create personalization
cd personalization && bun install && bun dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

```tsx
const { device, user, params } = useVariables();
```

**`device`** — platform, locale, OS, app version, filled in by the SDK.

**`user`** — whatever your app passed to `setUserAttributes`.

**`params`** — whatever the placement was called with.

**Guard every read.** All three are records the host controls, so a paywall
that assumes `user.firstName` exists breaks for everyone it does not.

Edit any of them in the studio's Variables panel and the paywall re-renders.
