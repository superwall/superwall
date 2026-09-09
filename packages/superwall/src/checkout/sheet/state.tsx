import * as React from "react";
import { initialSheetState, sheetReducer, type SheetActions, type SheetState } from "./reducer";
import { checkoutEvents } from "../events";

const StateContext = React.createContext<SheetState | null>(null);
const ActionsContext = React.createContext<SheetActions | null>(null);

export const SheetProvider = ({ children }: React.PropsWithChildren) => {
  const [state, dispatch] = React.useReducer(sheetReducer, initialSheetState);

  const actions = React.useMemo<SheetActions>(
    () => ({
      openSheet: (session) => dispatch({ type: "OPEN_SHEET", payload: session }),
      closeSheet: () => dispatch({ type: "CLOSE_SHEET" }),
      markSessionReady: (clientSecret) => dispatch({ type: "MARK_READY", payload: clientSecret }),
      addOrUpdateSession: (session) => dispatch({ type: "ADD_SESSION", payload: session }),
      removeSession: (clientSecret) => dispatch({ type: "REMOVE_SESSION", payload: clientSecret }),
      setProcessing: (isProcessing) => dispatch({ type: "SET_PROCESSING", payload: isProcessing }),
      setError: (error) => dispatch({ type: "SET_ERROR", payload: error }),
    }),
    [],
  );

  const ready = React.useRef(state.readyState);
  ready.current = state.readyState;

  React.useEffect(() => {
    const unsubscribers = [
      checkoutEvents.subscribe("SESSION_CREATED", (session) => {
        actions.addOrUpdateSession(session);
        if (ready.current.has(session.clientSecret)) {
          checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: session.clientSecret });
        }
      }),
      checkoutEvents.subscribe("SHEET_OPEN", ({ session }) => {
        actions.addOrUpdateSession(session);
        actions.openSheet(session);
      }),
      checkoutEvents.subscribe("SHEET_CLOSE", () => actions.closeSheet()),
      checkoutEvents.subscribe("EMBEDDED_READY", ({ clientSecret }) =>
        actions.markSessionReady(clientSecret),
      ),
      checkoutEvents.subscribe("PAYMENT_ERROR", ({ error }) => actions.setError(error)),
      checkoutEvents.subscribe("SESSION_INVALIDATED", () =>
        dispatch({ type: "CLEAR_ALL_SESSIONS" }),
      ),
    ];
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [actions]);

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
};

export const useSheetState = (): SheetState => {
  const state = React.useContext(StateContext);
  if (!state) throw new Error("useSheetState must be used within SheetProvider");
  return state;
};

export const useSheetActions = (): SheetActions => {
  const actions = React.useContext(ActionsContext);
  if (!actions) throw new Error("useSheetActions must be used within SheetProvider");
  return actions;
};
