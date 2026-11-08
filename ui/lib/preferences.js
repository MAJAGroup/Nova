// Carry local UI preferences forward without replacing a newer Nova setting.
export function migrateNovaPreferences(storage) {
  try {
    storage ??= localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) if (key?.startsWith("orbit.")) {
      const next = "nova." + key.slice(6);
      if (storage.getItem(next) === null) storage.setItem(next, storage.getItem(key));
    }
  } catch { /* Preferences are optional when local storage is unavailable. */ }
}
