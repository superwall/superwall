import { parseAsStringEnum } from "superwall/navigation";

export const GOALS = [
  { id: "focus", label: "Focus", hint: "Fewer, longer sessions" },
  { id: "habit", label: "Build a habit", hint: "A little every day" },
  { id: "catch-up", label: "Catch up", hint: "Work through a backlog" },
] as const;

export const goalParser = parseAsStringEnum(GOALS.map((goal) => goal.id));
