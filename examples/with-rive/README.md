# with-rive

Interactive vector animation, running on a canvas in the paywall.

```bash
superwall create --example with-rive
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

```tsx
import smiley from "../assets/smiley-switch.riv";

const { RiveComponent } = useRive({
  src: smiley,
  autoplay: true,
  stateMachines: "Remember Start SM",
  layout: new Layout({ fit: Fit.Cover }),
});
<RiveComponent />;
```

**Rive owns a canvas**, so it needs a component rather than a `src` attribute —
this is the difference between it and an image.

**Point Rive's WebAssembly at the bundled copy.** Rive fetches its engine at
runtime and defaults to unpkg; a published paywall's CSP lists no CDN, so the
canvas renders blank in production while working perfectly on your machine.
`components/RiveArt.tsx` fixes it once, at module scope:

```tsx
import riveWasm from "@rive-app/canvas/rive.wasm?url";

RuntimeLoader.setWasmUrl(riveWasm);
RuntimeLoader.setWasmFallbackUrl(null);
```

The engine becomes just another hosted asset, and dropping the fallback keeps a
failure loud instead of silently retrying an origin that is also blocked.

**Check which state machine you want.** A file often ships more than one, and
they are not interchangeable — this switch has `Simple SM`, which plays an
intro and settles, and `Remember Start SM`, which holds its state from the first
frame. Naming one that does not exist leaves a blank canvas and no error at
all.

**A `.riv` is always hosted**, whatever it weighs — uploaded by content hash and
fetched at runtime, so it costs nothing in the snapshot.

**Vector, so it scales.** One file is right on every screen, which is the reason
to reach for it over a video.

The `.riv` files in `assets/` were made for this example and are MIT like the
rest of it.

## Next

- [`orientation`](../orientation) — the layout that canvas has to live in
- [`custom-fonts`](../custom-fonts) — the other kind of asset the build hosts
