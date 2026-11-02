import Storage from "expo-sqlite/kv-store";
import * as SecureStore from "expo-secure-store";

/** App data (projects, tasks, the outbox) lives in on-device SQLite; the session token in the keychain. */
export const storage = {
  get: (key: string) => Storage.getItemAsync(key),
  set: (key: string, value: string) => Storage.setItemAsync(key, value),
  remove: (key: string) => Storage.removeItemAsync(key).then(() => undefined),
};

export const secrets = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
