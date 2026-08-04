type Listener = (loading: boolean) => void;

let loading = false;
const listeners = new Set<Listener>();

export const isLoading = () => loading;

export const subscribeLoading = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const set = (next: boolean) => {
  if (loading === next) return;
  loading = next;
  listeners.forEach((listener) => listener(next));
};

export const startLoading = () => set(true);
export const stopLoading = () => set(false);
