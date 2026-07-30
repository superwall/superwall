import type { PropsWithChildren } from "react";
import { useActions } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { AnswersProvider } from "../components/Answers";
import "./styles.css";

const Chrome = () => {
  const router = useRouter();
  const { close } = useActions();

  return (
    <header className="chrome">
      {router.canGoBack() ? (
        <button type="button" className="chrome-button" onClick={() => router.back()}>
          Back
        </button>
      ) : (
        <span className="chrome-button chrome-button-empty" />
      )}
      <span className="chrome-progress">
        {router.name === "plans" ? "Almost there" : `Step ${router.depth + 1}`}
      </span>
      <button type="button" className="chrome-button" onClick={close}>
        Close
      </button>
    </header>
  );
};

export default function Layout({ children }: PropsWithChildren) {
  return (
    <AnswersProvider>
      <div className="shell">
        <Chrome />
        {children}
      </div>
    </AnswersProvider>
  );
}
