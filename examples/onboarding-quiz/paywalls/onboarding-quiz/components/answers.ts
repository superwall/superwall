import { useActions, useUser } from "superwall/hooks";
import type { RouteName } from "superwall/navigation";

const GOALS = ["lose", "build", "endure"] as const;
const LEVELS = ["new", "returning", "regular"] as const;
const TIMES = ["15", "30", "45"] as const;

export type Goal = (typeof GOALS)[number];
export type Level = (typeof LEVELS)[number];
export type Time = (typeof TIMES)[number];

export type Answers = { goal?: Goal; level?: Level; time?: Time };

export type Question = keyof Answers;

/** The user attribute each answer is saved as: stable keys campaigns and analytics query. */
export const ATTRIBUTES: Record<Question, string> = {
  goal: "onboarding_goal",
  level: "onboarding_level",
  time: "onboarding_time",
};

/** The questions in the order they are asked. Each one's route has the same name. */
export const QUESTIONS: readonly Question[] = ["goal", "level", "time"];

// Attributes come back as strings, and the app may have set the key itself, so
// only one of the known options counts as an answer.
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find((option) => option === value);

/**
 * Every answer is a user attribute, saved the moment it is given. The host SDK
 * keeps them across presentations and launches, so a user who closes halfway
 * still has them the next time the paywall opens.
 */
export const useAnswers = () => {
  const user = useUser();
  const { setUserAttributes } = useActions();

  const answers: Answers = {
    goal: oneOf(GOALS, user[ATTRIBUTES.goal]),
    level: oneOf(LEVELS, user[ATTRIBUTES.level]),
    time: oneOf(TIMES, user[ATTRIBUTES.time]),
  };

  const save = <Q extends Question>(question: Q, value: NonNullable<Answers[Q]>) =>
    setUserAttributes({ [ATTRIBUTES[question]]: value });

  return { answers, save };
};

/**
 * Where the user left off, as a whole stack: the first screen, every answered
 * question, then the first unanswered one, or the plan once all are answered.
 */
export const resumeStack = (answers: Answers): RouteName[] => {
  const unanswered = QUESTIONS.findIndex((question) => answers[question] === undefined);
  if (unanswered === 0) return ["index"];
  if (unanswered === -1) return ["index", ...QUESTIONS, "plan"];
  return ["index", ...QUESTIONS.slice(0, unanswered + 1)];
};

export const PLAN: Record<Goal, { title: string; blurb: string }> = {
  lose: { title: "plan.lose.title", blurb: "plan.lose.blurb" },
  build: { title: "plan.build.title", blurb: "plan.build.blurb" },
  endure: { title: "plan.endure.title", blurb: "plan.endure.blurb" },
};
