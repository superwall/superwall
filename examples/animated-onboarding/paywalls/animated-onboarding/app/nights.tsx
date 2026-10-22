import { NIGHTS } from "../components/answers";
import { Question } from "../components/Question";

/** "kept": the chosen answer flies into the progress bar, the next question rises under it. */
export const transition = "story-kept";

export default function Nights() {
  return (
    <Question
      answer={NIGHTS}
      title="nights.title"
      options={[
        { value: "one", label: "nights.one" },
        { value: "few", label: "nights.few" },
        { value: "most", label: "nights.most" },
        { value: "every", label: "nights.every" },
      ]}
      next="statement"
    />
  );
}
