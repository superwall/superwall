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

const { RiveComponent } = useRive({ src: smiley, autoplay: true });
<RiveComponent />;
```

**Rive owns a canvas**, so it needs a component rather than a `src` attribute —
this is the difference between it and an image.

**Check which state machine you want.** A file often ships more than one, and
they are not interchangeable — this switch has `Simple SM`, which plays an
intro and settles, and `Remember Start SM`, which holds its state from the first
frame. Naming one that does not exist leaves a blank canvas and no error at
all.

**A `.riv` is always hosted**, whatever it weighs — uploaded by content hash and
fetched at runtime, so it costs nothing in the snapshot.

**Vector, so it scales.** One file is right on every screen, which is the reason
to reach for it over a video.
