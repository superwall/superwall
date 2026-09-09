import type { EmbeddedCheckoutSession } from "../types";

export type SheetState = {
  isOpen: boolean;
  activeSession: EmbeddedCheckoutSession | null;
  pooledSessions: ReadonlyMap<string, EmbeddedCheckoutSession>;
  readyState: ReadonlySet<string>;
  isProcessing: boolean;
  error: Error | null;
};

export type SheetAction =
  | { type: "OPEN_SHEET"; payload: EmbeddedCheckoutSession }
  | { type: "CLOSE_SHEET" }
  | { type: "MARK_READY"; payload: string }
  | { type: "ADD_SESSION"; payload: EmbeddedCheckoutSession }
  | { type: "REMOVE_SESSION"; payload: string }
  | { type: "CLEAR_ALL_SESSIONS" }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_ERROR"; payload: Error | null };

export type SheetActions = {
  openSheet: (session: EmbeddedCheckoutSession) => void;
  closeSheet: () => void;
  markSessionReady: (clientSecret: string) => void;
  addOrUpdateSession: (session: EmbeddedCheckoutSession) => void;
  removeSession: (clientSecret: string) => void;
  setProcessing: (isProcessing: boolean) => void;
  setError: (error: Error | null) => void;
};

export const initialSheetState: SheetState = {
  isOpen: false,
  activeSession: null,
  pooledSessions: new Map(),
  readyState: new Set(),
  isProcessing: false,
  error: null,
};

const keepOnly = (state: SheetState, clientSecret: string | undefined): SheetState => ({
  ...state,
  pooledSessions: new Map([...state.pooledSessions].filter(([secret]) => secret === clientSecret)),
  readyState: new Set([...state.readyState].filter((secret) => secret === clientSecret)),
});

export const sheetReducer = (state: SheetState, action: SheetAction): SheetState => {
  switch (action.type) {
    case "OPEN_SHEET":
      if (state.isOpen && state.activeSession?.clientSecret === action.payload.clientSecret) {
        return state;
      }
      return { ...state, isOpen: true, activeSession: action.payload, error: null };
    case "CLOSE_SHEET":
      return { ...state, isOpen: false, activeSession: null, isProcessing: false, error: null };
    case "MARK_READY":
      return { ...state, readyState: new Set(state.readyState).add(action.payload) };
    case "ADD_SESSION":
      return {
        ...keepOnly(state, action.payload.clientSecret),
        pooledSessions: new Map([[action.payload.clientSecret, action.payload]]),
      };
    case "CLEAR_ALL_SESSIONS":
      return keepOnly(state, state.activeSession?.clientSecret);
    case "REMOVE_SESSION": {
      const pooledSessions = new Map(state.pooledSessions);
      const readyState = new Set(state.readyState);
      pooledSessions.delete(action.payload);
      readyState.delete(action.payload);
      return { ...state, pooledSessions, readyState };
    }
    case "SET_PROCESSING":
      return { ...state, isProcessing: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload, isProcessing: false };
  }
};
