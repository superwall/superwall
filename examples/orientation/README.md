# orientation

Landscape that actually works, not just survives.

```bash
superwall create --example orientation
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

```tsx
const { orientation } = useDevice();
```

**Measured in the page, not sent by the SDK.** Every other value on
`useDevice()` comes over the bridge; this one updates the moment the device
turns.

**Landscape is not a narrower portrait.** It has width and almost no height, so
this paywall becomes two columns — copy and action together on the left, the
list filling the space that appeared. Nothing scrolls, nothing is cut off.

**Rotate the studio** with the button beside the theme toggle to check both.

## Next

- [`localization`](../localization) — copy that changes length under the layout
- [`with-tailwind`](../with-tailwind) — the same responsiveness in utilities
