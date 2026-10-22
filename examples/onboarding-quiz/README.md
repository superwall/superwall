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
what makes branching possible at all. Here the goal decides the path: losing
fat skips the level question.

**Every answer is saved the moment it is given**, as a user attribute. The
router carries no state and React state dies with the paywall, so an answer
kept anywhere else is gone when the user closes halfway. The host SDK keeps
attributes across presentations and launches. `useUserAttribute` reads and
writes one as typed state, with the same parsers as `useQueryState`, and
re-renders at once:

```ts
const goals = parseAsStringEnum(["lose", "build", "endure"]);
const [goal, setGoal] = useUserAttribute("onboarding_goal", goals);
setGoal("build");
```

The keys are stable snake_case names, because campaigns target on them and
analytics segment by them. A value the parser cannot read, such as an option
this version of the quiz no longer offers, reads as `null`: unanswered.

**The flow is one function.** `next(route, user)` in `components/answers.ts`
says where each screen leads. The buttons push what it returns, and the next
presentation replays it.

**The next presentation resumes at the first unanswered question of the
user's branch.** The layout exports `entry`, the stack to open on. It runs
once, with the host's attributes already in, so the resumed screen is the
first thing that paints and nothing outside the stack mounts. `replayStack`
walks `next` from the intro while each screen is answered:

```ts
export const entry: Entry = ({ user }) =>
  replayStack("index", (route) => next(route, user), (route) => answered(route, user));
```

Back and "Start over" behave as if the user had tapped through, down the
branch they actually took. Never store the current step; the answers already
say where the user is.

**`dismissAll()` returns to the first screen** without unwinding one at a
time.

## Next

- [`purchase-states`](../purchase-states) — what happens after the last screen
- [`web-funnel`](../web-funnel) — the same idea of steps, selling on the web
