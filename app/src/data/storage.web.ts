/** Browser build: everything in localStorage. */
const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const storage = {
  get: async (key: string) => safe(() => localStorage.getItem(key), null),
  set: async (key: string, value: string) => safe(() => localStorage.setItem(key, value), undefined),
  remove: async (key: string) => safe(() => localStorage.removeItem(key), undefined),
};

export const secrets = storage;
