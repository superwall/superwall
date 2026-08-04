import { createContext, useContext, useReducer, useMemo, useEffect, type ReactNode } from "react";
import { checkoutReducer, initialCheckoutState, defaultPresentation } from "./CheckoutStore";
import type { CheckoutState, CheckoutActions, SessionData, PresentationContext } from "./types";
import { checkoutEvents } from "../services/CheckoutEvents";

const CheckoutStateContext = createContext<CheckoutState | null>(null);
const CheckoutActionsContext = createContext<CheckoutActions | null>(null);

interface CheckoutProviderProps {
  children: ReactNode;
  presentation?: Partial<PresentationContext>;
}

export function CheckoutProvider({ children, presentation }: CheckoutProviderProps) {
  const [state, dispatch] = useReducer(checkoutReducer, {
    ...initialCheckoutState,
    presentation: {
      ...defaultPresentation,
      ...presentation,
    },
  });

  const actions = useMemo<CheckoutActions>(
    () => ({
      openSheet: (session: SessionData) => {
        dispatch({ type: "OPEN_SHEET", payload: session });
      },
      closeSheet: () => {
        dispatch({ type: "CLOSE_SHEET" });
      },
      markSessionReady: (clientSecret: string) => {
        dispatch({ type: "MARK_READY", payload: clientSecret });
      },
      addOrUpdateSession: (session: SessionData) => {
        dispatch({ type: "ADD_SESSION", payload: session });
      },
      touchSession: (clientSecret: string) => {
        dispatch({ type: "TOUCH_SESSION", payload: clientSecret });
      },
      removeSession: (clientSecret: string) => {
        dispatch({ type: "REMOVE_SESSION", payload: clientSecret });
      },
      setProcessing: (isProcessing: boolean) => {
        dispatch({ type: "SET_PROCESSING", payload: isProcessing });
      },
      setError: (error: Error | null) => {
        dispatch({ type: "SET_ERROR", payload: error });
      },
    }),
    [],
  );

  useEffect(() => {
    const unsubscribers = [
      checkoutEvents.subscribe("SESSION_CREATED", (session) => {
        actions.addOrUpdateSession(session);
        if (state.readyState.get(session.clientSecret)) {
          checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: session.clientSecret });
        }
      }),

      checkoutEvents.subscribe("SHEET_OPEN", ({ session }) => {
        if (session.deviceModel) {
          dispatch({ type: "SET_DEVICE_MODEL", payload: session.deviceModel });
        }
        actions.addOrUpdateSession(session);
        actions.openSheet(session);
        actions.touchSession(session.clientSecret);
      }),

      checkoutEvents.subscribe("SHEET_CLOSE", () => {
        actions.closeSheet();
      }),

      checkoutEvents.subscribe("EMBEDDED_READY", ({ clientSecret }) => {
        actions.markSessionReady(clientSecret);
      }),

      checkoutEvents.subscribe("PAYMENT_ERROR", ({ error }) => {
        actions.setError(error);
      }),

      checkoutEvents.subscribe("SESSION_INVALIDATED", () => {
        dispatch({ type: "CLEAR_ALL_SESSIONS" });
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [actions, state.readyState]);

  return (
    <CheckoutStateContext.Provider value={state}>
      <CheckoutActionsContext.Provider value={actions}>{children}</CheckoutActionsContext.Provider>
    </CheckoutStateContext.Provider>
  );
}

export function useCheckoutState(): CheckoutState {
  const context = useContext(CheckoutStateContext);
  if (!context) {
    throw new Error("useCheckoutState must be used within CheckoutProvider");
  }
  return context;
}

export function useCheckoutActions(): CheckoutActions {
  const context = useContext(CheckoutActionsContext);
  if (!context) {
    throw new Error("useCheckoutActions must be used within CheckoutProvider");
  }
  return context;
}

export function usePresentation() {
  const { presentation } = useCheckoutState();
  return presentation;
}
