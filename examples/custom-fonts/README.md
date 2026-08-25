# custom-fonts

Use any typeface, from a file in your own project.

```bash
superwall create --example custom-fonts
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**Drop the file in `assets/` and point at it.** That is the whole setup:

```css
@font-face {
  font-family: "Manrope Custom";
  font-style: normal;
  font-display: swap;
  font-weight: 200 800;
  src: url("../assets/manrope-latin.woff2") format("woff2-variations");
}
```

`font-weight: 200 800` is the line that makes a variable font vary — declare a
single weight and every other one is synthesised badly or ignored.

**The build uploads it and rewrites the URL.** Fonts are hosted by content
hash, never inlined, so the bytes stay out of the HTML and one upload is reused
across every version of every paywall:

```
https://user-content.superwalleditor.com/…/a30ddcd3….woff2   24 kB
```

Nothing to host yourself, nothing to configure.

**Subset before you ship.** A full variable font carries alphabets your paywall
will never render — this file is latin only at 24 kB, against roughly 90 for
every alphabet the family has.

**Ship a woff2.** Anything older is bytes you are paying for and nothing you
support still needs.

The bundled file is [Manrope](https://github.com/sharanda/manrope), licensed
under the SIL Open Font License 1.1 — the license text sits beside it in
`assets/OFL.txt`. Redistribute a font only with the notice its license asks for.

## Next

- [`with-tailwind`](../with-tailwind) — the rest of the styling, in utilities
- [`with-motion`](../with-motion) — animating what the type sits in
