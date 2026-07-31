# with-tailwind

Tailwind CSS v4 styling a paywall, with no framework configuration at all.

```bash
superwall create with-tailwind
cd with-tailwind && bun install && bun dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

```css
@import "tailwindcss";

@theme {
  --color-bg: #fdfef6;
  --color-accent: #46d7d4;
  --font-sans: Manrope, ui-sans-serif, system-ui, sans-serif;
}

@custom-variant dark (&:where(.dark, .dark *));
```

**One dev dependency, one config file.** `@tailwindcss/postcss` plus a
two-line `postcss.config.mjs` — the build and dev server pick it up on their
own, nothing in the framework knows Tailwind is there.

**v4 is configured in CSS.** `@theme` turns your palette into utilities
(`bg-bg`, `text-accent`), so the design tokens live next to the styles that
use them instead of in a JS config.

**`dark:` follows the SDK, not the OS.** The provider stamps a `dark` class on
the root from what the device reports, so the `@custom-variant` above is what
makes `dark:bg-bg` track the app's actual appearance — a bare media query
could not.

**Only what you use ships.** Tailwind compiles into the snapshot like any
other CSS; unused utilities never leave your machine.
