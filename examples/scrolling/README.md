# scrolling

A page taller than the screen, with a row of cards wider than it. The page
scrolls up and down, the row scrolls sideways, and neither drags the other.

```bash
superwall create --example scrolling
superwall dev
```

## Products

The identifier in `config.ts` is a placeholder. Point it at a product that
exists in your Superwall dashboard.

## What this shows

**The page is a normal document.** Content longer than the screen scrolls the
way any web page does; there is no scroll view to configure. The actions stay
pinned at the bottom (`position: sticky`) and the page scrolls under them.

**A sideways row is plain CSS.** `.carousel` is `overflow-x: auto` with
`scroll-snap-type: x mandatory`, so each swipe settles on a card. It bleeds to
the screen edges with a negative margin and keeps its padding as
`scroll-padding-inline`.

**Each direction stays put.** `overscroll-behavior-x: contain` on the row keeps
a sideways swipe that reaches its last card from moving anything else. The
studio follows the same rule: a swipe over the page scrolls the page, and the
stage around the device only pans when the paywall has nothing to scroll that
way.

## Next

- [`minimal`](../minimal) — the baseline this builds on
- [`multi-page`](../multi-page) — more than one screen
