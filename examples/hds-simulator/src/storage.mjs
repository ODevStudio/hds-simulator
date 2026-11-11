export const SETTINGS_KEY = "hds-simulator.settings.v1";
export const driftValues = Object.freeze([0, 0.05, 0.075, 0.1, 0.2]);

export const defaults = Object.freeze({
  screenFlipped: false,
  timeOnTop: false,
  appTextEnabled: false,
  wifiOnBoot: false,
  requireHeartbeat: true,
  bleButtons: false,
  autoSleep: true,
  quickBoot: false,
  tapTare: false,
  tapTimer: false,
  driftCompensation: 0.05,
  wakeOnWeight: 0,
});

export function validateSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const candidate = Object.hasOwn(source, key) ? source[key] : fallback;
    const valid = typeof fallback === "boolean" ? typeof candidate === "boolean" :
      key === "driftCompensation" ? driftValues.includes(candidate) :
      Number.isInteger(candidate) && candidate >= 0 && candidate <= 3;
    return [key, valid ? candidate : fallback];
  }));
}

export function readSettings(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(SETTINGS_KEY);
    if (!saved || saved.length > 4096) return { ...defaults };
    const envelope = JSON.parse(saved);
    return envelope?.version === 1 ? validateSettings(envelope.settings) : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return false;
    target.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, settings: validateSettings(settings) }));
    return true;
  } catch {
    return false;
  }
}
