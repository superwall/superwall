import * as React from "react";

export type Goal = "lose" | "build" | "endure";
export type ExperienceLevel = "new" | "returning" | "seasoned";

export type Answers = {
  goal?: Goal;
  experience?: ExperienceLevel;
  daysPerWeek: number;
};

type Store = [Answers, (patch: Partial<Answers>) => void];

const AnswersContext = React.createContext<Store | null>(null);

export const AnswersProvider = ({ children }: React.PropsWithChildren) => {
  const [answers, setAnswers] = React.useState<Answers>({ daysPerWeek: 3 });

  const store = React.useMemo<Store>(
    () => [answers, (patch) => setAnswers((current) => ({ ...current, ...patch }))],
    [answers],
  );

  return <AnswersContext.Provider value={store}>{children}</AnswersContext.Provider>;
};

export const useAnswers = (): Store => {
  const store = React.useContext(AnswersContext);
  if (!store) throw new Error("useAnswers() must be used inside the onboarding layout");
  return store;
};
