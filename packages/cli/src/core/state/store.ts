export interface Store {
  read(name: string): string | undefined;
  write(name: string, text: string): void;
  remove(name: string): void;
}

export interface Stores {
  cache: Store;
  state: Store;
}

export function memoryStore(): Store {
  const files = new Map<string, string>();
  return {
    read: (name) => files.get(name),
    write: (name, text) => void files.set(name, text),
    remove: (name) => void files.delete(name),
  };
}

export const emptyStore: Store = {
  read: () => undefined,
  write: () => {},
  remove: () => {},
};

let current: Stores = { cache: memoryStore(), state: memoryStore() };

export function useStores(stores: Stores): void {
  current = stores;
}

export const cache = (): Store => current.cache;
export const state = (): Store => current.state;

export function readJson<T>(store: Store, name: string): T | undefined {
  const text = store.read(name);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
