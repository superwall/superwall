# animated-onboarding

An onboarding flow whose motion tells its story: the chosen answer flies into
the progress bar and grows it, opens into the next page's photo, floods a
statement screen with its own colour and collapses that colour into the bar.
Every page-to-page hand-off is its own choreography, and every one of them
plays in reverse when the user goes back.

```bash
superwall create --example animated-onboarding
superwall dev
```

Tap through it on a phone (the studio's **Preview** button shows a QR code):
none of this is meant to be judged in a desktop browser.

## Products

The identifier in `config.ts` is a placeholder. Point it at a product that
exists in your Superwall dashboard, or the last page's price renders empty.

## What this shows

**A hand-off is a transition name.** Each page names how it arrives:

```tsx
// app/insight.tsx
export const transition = "story-picture";
```

The router puts that name on both page layers during the navigation, with
`data-sw-phase` saying which side each is on (`enter` / `recede` going
forward, `return` / `leave` going back). `app/motion.css` keys everything on
those two attributes: the old page's lines drift out, the new page's title,
subtitle and answers rise in 40ms apart. The leaving page stays mounted for as
long as the animation declared on its layer runs, so the layer gets a silent
hold of the hand-off's length (`story-hold`) and nothing is cloned.

**The shared elements are the script's.** What CSS can't do is move one thing
from the old page into the new one. `components/motion/handoffs.ts` measures
the chosen answer and the bar, swaps the route synchronously, measures the
destination, and animates a copy between them:

```ts
flushSync(() => router.push("nights", { transition: "story-kept" }));
// the new page is in the DOM now: measure it, then fly
```

Copies are pinned inside the layout's motion layer (`[data-motion-layer]`,
absolute over the content box), never `position: fixed`, so they respect the
insets and ride with nothing.

**One frame, two faces.** An answer opening into a photo or a full-screen
colour is one element that owns all of the geometry (clip, transform, blur),
with the two faces only crossfading inside it (`morphFrame.ts`). Two separate
layers "driven by the same numbers" drift apart by a pixel and the morph reads
as broken.

**Persistent chrome lives in `layout.tsx`.** The progress bar survives every
navigation, which is what the answer has to fly into. The layout reads the
route from `useRouter()` to set the bar's fraction and invert its chrome on the
statement page.

**Pages stay mounted behind the next one.** A question keeps its selected
answer, so going back hands it out of the bar; and it releases its commit lock
when it regains focus (`useIsFocused()`), or the user could never re-answer.

**Keyboard and reduced motion get the router's plain fade.** The wrapper
(`useStoryRouter.ts`) asks for `fade` instead of a story transition, and none
of the story CSS applies.

## Files

| file | what it is |
| --- | --- |
| `components/flow.ts` | the routes, each one's hand-off, its progress fraction and its image |
| `components/motion/useStoryRouter.ts` | `router.push` / `back` wrapped in the hand-off, waiting for the destination's image |
| `components/motion/handoffs.ts` | the engine: answer → bar, back out of the bar, picture, flood, absorb |
| `components/motion/morphFrame.ts` | the one-geometry morph: frame, faces, the critically damped clock |
| `components/motion/imageReady.ts` | decoded images kept warm, for Safari |
| `app/motion.css` | the exits and entrances, keyed on the router's phases |

The direction behind it (what to move, what never to, what was tried and
rejected) is the `animate-onboarding` skill in
[superwall/skills](https://github.com/superwall/skills).

## Next

- [`onboarding-quiz`](../onboarding-quiz) — the same shape of flow without the choreography
- [`transitions`](../transitions) — the built-in transitions, and a custom one
