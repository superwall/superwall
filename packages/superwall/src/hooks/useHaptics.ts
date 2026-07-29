import * as React from "react";
import { useSuperwallSession } from "../provider/context";

export type UseHapticsResult = {
  light: () => void;
  medium: () => void;
  heavy: () => void;
  success: () => void;
  warning: () => void;
  error: () => void;
  selection: () => void;
};

export const useHaptics = (): UseHapticsResult => {
  const session = useSuperwallSession();

  return React.useMemo(
    () => ({
      light: () => session.hapticFeedback("light"),
      medium: () => session.hapticFeedback("medium"),
      heavy: () => session.hapticFeedback("heavy"),
      success: () => session.hapticFeedback("success"),
      warning: () => session.hapticFeedback("warning"),
      error: () => session.hapticFeedback("error"),
      selection: () => session.hapticFeedback("selection"),
    }),
    [session],
  );
};
