import { Question } from "../components/Question";

/** "absorb": the statement's colour collapses into the bar, this question rises as it clears. */
export const transition = "story-absorb";

export default function Tried() {
  return (
    <Question
      attribute="tried_before"
      title="tried.title"
      options={[
        { value: "nothing", label: "tried.nothing" },
        { value: "melatonin", label: "tried.melatonin" },
        { value: "apps", label: "tried.apps" },
        { value: "routine", label: "tried.routine" },
      ]}
      next="insight"
    />
  );
}
