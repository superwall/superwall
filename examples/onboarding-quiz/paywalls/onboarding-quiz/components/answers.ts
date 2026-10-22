import { parseAsStringEnum, readAttribute, type UserAttributes } from "superwall/hooks";
import type { RouteName } from "superwall/navigation";

export const GOAL = {
  key: "onboarding_goal",
  parser: parseAsStringEnum(["lose", "build", "endure"]),
};
export const LEVEL = {
  key: "onboarding_level",
  parser: parseAsStringEnum(["new", "returning", "regular"]),
};
export const TIME = {
  key: "onboarding_time",
  parser: parseAsStringEnum(["15", "30", "45"]),
};

export type Goal = NonNullable<ReturnType<typeof GOAL.parser.parse>>;
export type Level = NonNullable<ReturnType<typeof LEVEL.parser.parse>>;
export type Time = NonNullable<ReturnType<typeof TIME.parser.parse>>;

export type Answers = { goal: Goal | null; level: Level | null; time: Time | null };

export const answersOf = (user: UserAttributes): Answers => ({
  goal: readAttribute(user, GOAL.key, GOAL.parser),
  level: readAttribute(user, LEVEL.key, LEVEL.parser),
  time: readAttribute(user, TIME.key, TIME.parser),
});

export const next = (route: RouteName, user: UserAttributes): RouteName | undefined => {
  const answers = answersOf(user);
  switch (route) {
    case "index":
      return "goal";
    case "goal":
      return answers.goal === "lose" ? "time" : "level";
    case "level":
      return "time";
    case "time":
      return "plan";
    default:
      return undefined;
  }
};

export const answered = (route: RouteName, user: UserAttributes): boolean => {
  const answers = answersOf(user);
  switch (route) {
    case "index":
    case "goal":
      return answers.goal !== null;
    case "level":
      return answers.level !== null;
    case "time":
      return answers.time !== null;
    default:
      return false;
  }
};

export const questionsFor = (user: UserAttributes): RouteName[] => {
  const asked: RouteName[] = [];
  let route = next("index", user);
  while (route && route !== "plan") {
    asked.push(route);
    route = next(route, user);
  }
  return asked;
};

export const PLAN: Record<Goal, { title: string; blurb: string }> = {
  lose: { title: "plan.lose.title", blurb: "plan.lose.blurb" },
  build: { title: "plan.build.title", blurb: "plan.build.blurb" },
  endure: { title: "plan.endure.title", blurb: "plan.endure.blurb" },
};
