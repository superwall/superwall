import { STRUGGLE } from "../components/answers";
import { Question } from "../components/Question";

/** This page arrives by the "begin" hand-off (flow.ts): the cover gives way, the question rises. */
export const transition = "story-begin";

export default function Goal() {
  return (
    <Question
      answer={STRUGGLE}
      title="goal.title"
      options={[
        { value: "racing", label: "goal.racing" },
        { value: "waking", label: "goal.waking" },
        { value: "schedule", label: "goal.schedule" },
        { value: "noise", label: "goal.noise" },
      ]}
      next="nights"
    />
  );
}
