import * as React from "react";
import { useSuperwallSession } from "../../provider/context";
import { watchCompletedCheckouts } from "../flow";

export const useCheckoutCompletion = () => {
  const session = useSuperwallSession();
  React.useEffect(() => watchCompletedCheckouts(session), [session]);
};
