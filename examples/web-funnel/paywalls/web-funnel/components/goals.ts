import { parseAsStringEnum } from "superwall/navigation";

// `phrase` is how the goal reads inside a sentence ("A plan for building a
// habit."): a catalog key, so the URL id never surfaces as copy.
export const GOALS = [
  { id: "focus", label: "goals.focus.label", hint: "goals.focus.hint", phrase: "goals.focus.phrase" },
  { id: "habit", label: "goals.habit.label", hint: "goals.habit.hint", phrase: "goals.habit.phrase" },
  {
    id: "catch-up",
    label: "goals.catchUp.label",
    hint: "goals.catchUp.hint",
    phrase: "goals.catchUp.phrase",
  },
] as const;

export const goalParser = parseAsStringEnum(GOALS.map((goal) => goal.id));
