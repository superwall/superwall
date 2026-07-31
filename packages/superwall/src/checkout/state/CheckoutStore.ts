import type { CheckoutState, CheckoutAction } from "./types";
import { MAX_POOL_SIZE } from "../utils/constants";

export const defaultPresentation = {
  isFullscreen: false,
  deviceModel: "",
};

export const initialCheckoutState: CheckoutState = {
  isOpen: false,
  activeSession: null,
  pooledSessions: new Map(),
  poolOrder: [],
  readyState: new Map(),
  isProcessing: false,
  error: null,
  presentation: defaultPresentation,
};

export function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case "OPEN_SHEET": {
      const session = action.payload;

      if (state.isOpen && state.activeSession?.clientSecret === session.clientSecret) {
        console.log(
          "[CheckoutStore] Sheet already open for this session, skipping:",
          session.clientSecret.substring(0, 20),
        );
        return state;
      }

      return {
        ...state,
        isOpen: true,
        activeSession: session,
        error: null,
      };
    }

    case "CLOSE_SHEET": {
      return {
        ...state,
        isOpen: false,
        activeSession: null,
        isProcessing: false,
        error: null,
      };
    }

    case "MARK_READY": {
      const clientSecret = action.payload;
      const newReadyState = new Map(state.readyState);
      newReadyState.set(clientSecret, true);
      console.log("[CheckoutStore] Marked as ready:", clientSecret.substring(0, 20) + "...");
      return {
        ...state,
        readyState: newReadyState,
      };
    }

    case "ADD_SESSION": {
      const session = action.payload;
      const clientSecret = session.clientSecret;

      const newPoolOrder = [...state.poolOrder];
      const newPooledSessions = new Map(state.pooledSessions);
      const newReadyState = new Map(state.readyState);

      if (session.directive === "embedded") {
        for (const [existingSecret, existingSession] of newPooledSessions) {
          if (existingSession.directive === "embedded" && existingSecret !== clientSecret) {
            console.log(
              "[CheckoutStore] Removing old embedded session:",
              existingSecret.substring(0, 20) + "...",
            );
            newPooledSessions.delete(existingSecret);
            newReadyState.delete(existingSecret);
            const idx = newPoolOrder.indexOf(existingSecret);
            if (idx !== -1) {
              newPoolOrder.splice(idx, 1);
            }
          }
        }
      }

      const existingIndex = newPoolOrder.indexOf(clientSecret);
      if (existingIndex !== -1) {
        newPoolOrder.splice(existingIndex, 1);
      }

      newPoolOrder.unshift(clientSecret);
      newPooledSessions.set(clientSecret, session);

      if (!newReadyState.has(clientSecret)) {
        newReadyState.set(clientSecret, false);
      }

      if (newPoolOrder.length > MAX_POOL_SIZE) {
        const evicted = newPoolOrder.pop();
        if (evicted) {
          console.log("[CheckoutStore] Evicting LRU session:", evicted.substring(0, 20) + "...");
          newPooledSessions.delete(evicted);
          newReadyState.delete(evicted);
        }
      }

      return {
        ...state,
        poolOrder: newPoolOrder,
        pooledSessions: newPooledSessions,
        readyState: newReadyState,
      };
    }

    case "TOUCH_SESSION": {
      const clientSecret = action.payload;
      const newPoolOrder = [...state.poolOrder];
      const existingIndex = newPoolOrder.indexOf(clientSecret);

      if (existingIndex === -1 || existingIndex === 0) {
        return state;
      }

      newPoolOrder.splice(existingIndex, 1);
      newPoolOrder.unshift(clientSecret);

      return {
        ...state,
        poolOrder: newPoolOrder,
      };
    }

    case "CLEAR_ALL_SESSIONS": {
      const activeSecret = state.activeSession?.clientSecret;
      const activeSession = activeSecret ? state.pooledSessions.get(activeSecret) : undefined;

      if (!activeSession) {
        return {
          ...state,
          pooledSessions: new Map(),
          poolOrder: [],
          readyState: new Map(),
        };
      }

      const newPooledSessions = new Map([[activeSecret!, activeSession]]);
      const newReadyState = new Map<string, boolean>();
      const wasReady = state.readyState.get(activeSecret!);
      if (wasReady !== undefined) {
        newReadyState.set(activeSecret!, wasReady);
      }

      return {
        ...state,
        pooledSessions: newPooledSessions,
        poolOrder: [activeSecret!],
        readyState: newReadyState,
      };
    }

    case "REMOVE_SESSION": {
      const clientSecret = action.payload;
      const newPoolOrder = state.poolOrder.filter((cs) => cs !== clientSecret);
      const newPooledSessions = new Map(state.pooledSessions);
      const newReadyState = new Map(state.readyState);

      newPooledSessions.delete(clientSecret);
      newReadyState.delete(clientSecret);

      console.log("[CheckoutStore] Removed session:", clientSecret.substring(0, 20) + "...");

      return {
        ...state,
        poolOrder: newPoolOrder,
        pooledSessions: newPooledSessions,
        readyState: newReadyState,
      };
    }

    case "SET_PROCESSING": {
      return {
        ...state,
        isProcessing: action.payload,
      };
    }

    case "SET_ERROR": {
      return {
        ...state,
        error: action.payload,
        isProcessing: false,
      };
    }

    case "SET_DEVICE_MODEL": {
      return {
        ...state,
        presentation: {
          ...state.presentation,
          deviceModel: action.payload,
        },
      };
    }

    default:
      return state;
  }
}
