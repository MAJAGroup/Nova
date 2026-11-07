// AI endpoint settings as the renderer sees them. The API key itself never
// reaches the renderer; only whether one is stored.
export function createAIConfig(browser) {
  let config = {};
  const listeners = new Set();

  function set(next) {
    config = next || {};
    listeners.forEach((listener) => listener(config));
  }

  browser.getAIConfig().then(set);

  return {
    get: () => config,
    set,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
