import { parseAsStringEnum } from "superwall/navigation";

export const GOALS = [
  { id: "focus", label: "goals.focus.label", hint: "goals.focus.hint" },
  { id: "habit", label: "goals.habit.label", hint: "goals.habit.hint" },
  { id: "catch-up", label: "goals.catchUp.label", hint: "goals.catchUp.hint" },
] as const;

export const goalParser = parseAsStringEnum(GOALS.map((goal) => goal.id));
