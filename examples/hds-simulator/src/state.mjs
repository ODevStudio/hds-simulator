import { defaults, driftValues, validateSettings } from "./storage.mjs";
import { backToMain, driftLabel, infoScreens, isMenu, menuRows, navigateMenu, openMenu, selectedMenuItem } from "./menus.mjs";
import { consumeHeldButtons, DOUBLE_CLICK_MS, heldButtons, initialButtons, nextButtonDeadline, pressButton, releaseButton, takeDueButtons } from "./buttons.mjs";

export { defaults, readSettings, saveSettings } from "./storage.mjs";
export { menuRows } from "./menus.mjs";

const emptyPrompt = (session = 0, cancelled = false, generation = 0) =>
  ({ text: "", active: false, startedAt: null, session, cancelled, generation });
const validNumber = (value) => typeof value === "number" && Number.isFinite(value);
const boundedWeight = (value) => Math.max(-10000, Math.min(10000, value));

export function createState(settings = defaults) {
  const saved = validateSettings(settings);
  return {
    now: 0, screen: "boot", transition: { at: 1000, kind: "boot" }, setupBoot: false,
    settings: saved, menu: { id: "main", selected: 0 }, buttons: initialButtons(), chordAt: null,
    grossWeight: 0, tareOffset: 0, pourRate: 3, pouring: false, timerMs: 0, timerRunning: false,
    icons: { bleEnabled: true, bleConnected: false, wifiEnabled: saved.wifiOnBoot, wifiConnected: false,
      batteryPercent: 75, usbPresent: true, charging: true, heartbeat: false },
    info: { firmwareVersion: "FW: 3.1.16", buildDate: "Nov 09 2026", revision: "6f2ac69",
      deviceName: "hds-simulator", ssid: "N/A", ip: "0.0.0.0", wifiMode: saved.wifiOnBoot ? "AP" : "Idle",
      wifiCredentialsSaved: false, batteryVoltage: 3.925, batteryPage: 0, calibrated: false },
    feedback: null, status: "", restartPending: false, logoNextSample: false,
    prompt: emptyPrompt(), tareUntil: 0, shutdownUntil: 0, menuExitedAt: -1001, lastActivityAt: 0,
  };
}

function settle(state) {
  const visible = state.prompt.active && state.settings.appTextEnabled && state.icons.bleConnected &&
    state.icons.bleEnabled && state.screen === "weighing" && state.grossWeight - state.tareOffset <= 1500 &&
    state.now >= state.shutdownUntil;
  const startedAt = visible ? state.prompt.startedAt ?? state.now : null;
  return { ...state, feedback: state.feedback && state.now < state.feedback.until ? state.feedback : null,
    prompt: { ...state.prompt, startedAt, visible } };
}

function feedback(state, text, text2 = "", duration = 1000) {
  return { ...state, feedback: { text, text2, until: state.now + duration }, status: "" };
}

function restart(state, setup = false, settings = state.settings) {
  const fresh = createState(settings);
  return { ...fresh, now: state.now, setupBoot: setup, transition: { at: state.now + 1000, kind: "boot" },
    grossWeight: state.grossWeight, pourRate: state.pourRate, icons: { ...fresh.icons,
      usbPresent: state.icons.usbPresent, charging: state.icons.charging, batteryPercent: state.icons.batteryPercent },
    info: { ...fresh.info, batteryVoltage: state.info.batteryVoltage }, lastActivityAt: state.now };
}

function beginExit(state) {
  return feedback({ ...state, screen: "main", menu: { id: "main", selected: 0 },
    transition: { at: state.now + 1000, kind: "exit" } }, "Exit Menu");
}

function back(state) {
  return state.menu.id === "main" ? beginExit(state) : backToMain(state);
}

function activate(state) {
  const item = selectedMenuItem(state);
  if (item.kind === "menu") return openMenu(state, item.id);
  if (item.kind === "back") return back(state);
  if (item.kind === "exit") return beginExit(state);
  if (item.kind === "deferred") return { ...state, status: `${item.title} requires hardware and is not included in this browser simulation.` };
  if (item.kind === "page") return { ...state, screen: item.screen === "logo" && state.logoNextSample ? "logoSample" : item.screen, feedback: null, status: "" };
  if (item.kind === "toggle" || item.kind === "timeOnTop") {
    const key = item.setting ?? "timeOnTop";
    const enabled = !state.settings[key];
    const next = { ...state, settings: { ...state.settings, [key]: enabled },
      restartPending: state.restartPending || key === "wifiOnBoot",
      prompt: key === "appTextEnabled" ? emptyPrompt(state.prompt.session, state.prompt.cancelled, state.prompt.generation + 1) : state.prompt };
    return feedback(next, item.title ?? "Top", enabled ? "ON" : "OFF");
  }
  if (item.kind === "drift") {
    const value = driftValues[(driftValues.indexOf(state.settings.driftCompensation) + 1) % driftValues.length];
    return feedback({ ...state, settings: { ...state.settings, driftCompensation: value } }, "Drift", driftLabel(value));
  }
  if (item.kind === "wakeOnWeight") {
    if (!state.info.calibrated && state.settings.wakeOnWeight === 0) return feedback(state, "WakeOnWeight", "Please calibrate", 2000);
    const value = state.info.calibrated ? (state.settings.wakeOnWeight + 1) % 4 : 0;
    return feedback({ ...state, settings: { ...state.settings, wakeOnWeight: value } }, "WakeOnWeight", ["Off", "Sleep 2s", "Sleep 3s", "Sleep 4s"][value]);
  }
  if (item.kind === "resetWifi") return feedback({ ...state, restartPending: true,
    info: { ...state.info, wifiCredentialsSaved: false } }, "WiFi Reset", "Restart on exit");
  return state;
}

function timerCycle(state) {
  if (state.timerRunning) return { ...state, timerRunning: false, lastActivityAt: state.now };
  return Math.floor(state.timerMs / 1000) > 0 ? { ...state, timerMs: 0, lastActivityAt: state.now } :
    { ...state, timerRunning: true, lastActivityAt: state.now };
}

function scaleTap(state, count) {
  const buttonActive = Object.values(state.buttons).some((press) => press.downAt !== null ||
    press.releasedAt !== null && state.now - press.releasedAt <= DOUBLE_CLICK_MS);
  if (state.screen !== "weighing" || buttonActive || state.now < state.shutdownUntil ||
      state.now - state.menuExitedAt <= 1000) return state;
  if (count === 3 && state.settings.tapTimer) return timerCycle(state);
  if (count === 2 && state.settings.tapTare && !state.timerRunning) return { ...state,
    tareOffset: state.grossWeight, tareUntil: state.now + 500, lastActivityAt: state.now };
  return state;
}

function wake(state) {
  return consumeHeldButtons({ ...state, screen: "weighing", transition: null, lastActivityAt: state.now,
    icons: { ...state.icons, bleEnabled: true, wifiEnabled: state.settings.wifiOnBoot },
    info: { ...state.info, wifiMode: state.settings.wifiOnBoot ? "AP" : "Idle" } });
}

function powerOff(state) {
  return consumeHeldButtons({ ...state, screen: "off", transition: state.icons.usbPresent ? { at: state.now + 1000, kind: "charging" } : null,
    pouring: false, shutdownUntil: 0, prompt: emptyPrompt(state.prompt.session), icons: { ...state.icons, bleConnected: false } });
}

function applyButton(state, action) {
  if (!action || action.consumed || state.transition && !["boot", "setup"].includes(state.transition.kind)) return state;
  if (action.type === "chord") return openMenu(wake(state), "main");
  if (["boot", "setup"].includes(state.screen)) return state;
  if (infoScreens.includes(state.screen)) {
    const dismiss = state.screen === "batteryInfo" ? action.name === "circle" : action.name === "square";
    if ((action.type === "tap" || action.type === "release") && dismiss) return { ...state, screen: state.menu.id,
      logoNextSample: ["logo", "logoSample"].includes(state.screen) ? !state.logoNextSample : state.logoNextSample };
    return state;
  }
  if (isMenu(state.screen)) {
    if (action.type === "hold") return action.name === "circle" ? navigateMenu(state, -1) : back(state);
    if (action.type === "tap") return action.name === "circle" ? navigateMenu(state, 1) : activate(state);
    return state;
  }
  if (["off", "charging"].includes(state.screen)) {
    return action.type === "hold" || action.type === "tap" && state.settings.quickBoot ? wake(state) : state;
  }
  if (state.screen !== "weighing") return state;
  if (action.type === "hold" && action.name === "circle" && state.prompt.visible) {
    return { ...state, prompt: emptyPrompt(state.prompt.session, true, state.prompt.generation + 1) };
  }
  if (action.type !== "tap" || state.now - state.menuExitedAt <= 1000) return state;
  if (action.double) return state.icons.bleConnected ? { ...state, shutdownUntil: state.now + 3000 } : powerOff(state);
  if (state.icons.bleConnected && !state.settings.bleButtons) return state;
  return action.name === "circle" ? { ...state, tareOffset: state.grossWeight, tareUntil: state.now + 500, lastActivityAt: state.now } : timerCycle(state);
}

function connection(state, connected) {
  if (typeof connected !== "boolean") return state;
  if (connected && !state.icons.bleEnabled) return { ...state, status: "Enable Bluetooth before connecting the simulated app." };
  if (connected === state.icons.bleConnected) return state;
  return { ...state, icons: { ...state.icons, bleConnected: connected }, status: "", lastActivityAt: state.now,
    prompt: emptyPrompt(state.prompt.session + (connected ? 1 : 0), false, state.prompt.generation + 1) };
}

function setPrompt(state, text) {
  if (typeof text !== "string" || !/^[\x20-\x7e]{1,128}$/.test(text)) return { ...state, status: "App Text requires 1-128 printable ASCII characters." };
  if (!state.settings.appTextEnabled || !state.icons.bleConnected || state.prompt.cancelled) return { ...state,
    status: state.prompt.cancelled ? "App Text is cancelled until the simulated app reconnects." : "Enable App Text and connect the simulated app first." };
  if (state.prompt.active && state.prompt.text === text) return state;
  return { ...state, status: "", prompt: { ...state.prompt, active: true, text, startedAt: null, generation: state.prompt.generation + 1 } };
}

function setWifi(state, event) {
  const enabled = typeof event.enabled === "boolean" ? event.enabled : state.icons.wifiEnabled;
  const connected = enabled && (typeof event.connected === "boolean" ? event.connected : state.icons.wifiConnected);
  return { ...state, icons: { ...state.icons, wifiEnabled: enabled, wifiConnected: connected },
    info: { ...state.info, wifiMode: connected ? "Conn" : enabled ? "AP" : "Idle",
      wifiCredentialsSaved: connected || state.info.wifiCredentialsSaved,
      ssid: connected ? (typeof event.ssid === "string" ? event.ssid.slice(0, 32) : "Simulator WiFi") : "N/A",
      ip: connected ? (typeof event.ip === "string" ? event.ip.slice(0, 40) : "192.0.2.2") : "0.0.0.0" } };
}

function control(state, event) {
  switch (event.type) {
    case "setWeight": return validNumber(event.value) && Math.abs(event.value) <= 10000 ?
      { ...state, grossWeight: event.value, lastActivityAt: state.now } : state;
    case "setPourRate": return validNumber(event.value) && event.value >= 0 && event.value <= 1000 ? { ...state, pourRate: event.value } : state;
    case "togglePour": return { ...state, pouring: !state.pouring, lastActivityAt: state.now };
    case "timerCycle": return state.screen === "weighing" ? timerCycle(state) : state;
    case "scaleTap": return scaleTap(state, event.count);
    case "tare": return state.screen === "weighing" ? { ...state, tareOffset: state.grossWeight, tareUntil: state.now + 500, lastActivityAt: state.now } : state;
    case "setConnection": return connection(state, event.connected);
    case "setBle": return typeof event.enabled === "boolean" && event.enabled !== state.icons.bleEnabled ?
      { ...connection(state, false), icons: { ...state.icons, bleEnabled: event.enabled, bleConnected: false } } : state;
    case "setWifi": return setWifi(state, event);
    case "setUsb": {
      const present = typeof event.present === "boolean" ? event.present : state.icons.usbPresent;
      return { ...state, chordAt: present ? state.chordAt : null, icons: { ...state.icons, usbPresent: present,
        charging: present && (typeof event.charging === "boolean" ? event.charging : state.icons.charging) } };
    }
    case "setBattery": return validNumber(event.percent) ? { ...state,
      icons: { ...state.icons, batteryPercent: Math.max(0, Math.min(100, event.percent)) },
      info: { ...state.info, batteryVoltage: 3.4 + Math.max(0, Math.min(100, event.percent)) * 0.007 } } : state;
    case "setPrompt": return setPrompt(state, event.text);
    case "clearPrompt": return { ...state, prompt: emptyPrompt(state.prompt.session, state.prompt.cancelled, state.prompt.generation + 1), status: "" };
    case "restart": return restart(state, event.setup === true);
    case "resetDefaults": return restart(state, false, defaults);
    case "jump": {
      const next = { ...state, buttons: initialButtons(), chordAt: null, transition: null, lastActivityAt: state.now };
      return event.screen === "boot" ? restart(state) : isMenu(event.screen) ? openMenu(next, event.screen) :
        event.screen === "weighing" ? { ...next, screen: "weighing", feedback: null, status: "" } : state;
    }
    default: return state;
  }
}

export function dispatch(state, event) {
  if (!event || typeof event !== "object") return state;
  if (event.type === "cancelButtons") return settle({ ...state, buttons: initialButtons(), chordAt: null });
  if (event.type === "buttonCancel" && ["circle", "square"].includes(event.name)) return settle({ ...state,
    buttons: { ...state.buttons, [event.name]: initialButtons()[event.name] }, chordAt: null });
  if (event.type === "buttonDown") {
    const pressed = pressButton(state, event.name);
    const confirmShutdown = pressed !== state && event.name === "square" && state.screen === "weighing" &&
      state.icons.bleConnected && state.now < state.shutdownUntil && state.now - state.menuExitedAt > 1000;
    return settle(confirmShutdown ? powerOff(pressed) : pressed);
  }
  if (event.type === "buttonUp") {
    const released = releaseButton(state, event.name);
    return settle(applyButton(released.state, released.action));
  }
  return settle(control(state, event));
}

function elapse(state, ms) {
  const pouring = state.pouring && state.pourRate > 0;
  return { ...state, now: state.now + ms, grossWeight: boundedWeight(state.grossWeight + (pouring ? state.pourRate * ms / 1000 : 0)),
    timerMs: state.timerMs + (state.timerRunning ? ms : 0), lastActivityAt: pouring || state.icons.bleConnected ? state.now + ms : state.lastActivityAt };
}

function autoOffAt(state) {
  return state.screen === "weighing" && state.settings.autoSleep && !state.icons.usbPresent &&
    !state.icons.charging && !state.icons.bleConnected && !(state.pouring && state.pourRate > 0) ? state.lastActivityAt + 900000 : Infinity;
}

function transition(state) {
  if (!state.transition || state.now < state.transition.at) return state;
  if (state.transition.kind === "boot") {
    const held = heldButtons(state);
    const setup = state.setupBoot || held.circle && held.square;
    const next = consumeHeldButtons({ ...state, tareOffset: state.grossWeight, lastActivityAt: state.now });
    return { ...next, screen: setup ? "setup" : "weighing", transition: setup ? { at: state.now + 1000, kind: "setup" } : null };
  }
  if (state.transition.kind === "setup") return openMenu({ ...state, transition: null }, "main");
  if (state.transition.kind === "charging") return { ...state, screen: state.icons.usbPresent ? "charging" : "off", transition: null };
  if (state.restartPending) return restart(state);
  return { ...state, screen: "weighing", transition: null, feedback: null, menuExitedAt: state.now, lastActivityAt: state.now };
}

export function advance(state, ms) {
  if (!validNumber(ms) || ms < 0 || !Number.isSafeInteger(Math.floor(state.now + ms))) return state;
  const target = state.now + ms;
  let current = state;
  while (true) {
    const warningEnds = current.shutdownUntil > current.now ? current.shutdownUntil : Infinity;
    const deadline = Math.min(current.transition?.at ?? Infinity, nextButtonDeadline(current), autoOffAt(current), warningEnds);
    if (deadline > target) return settle(elapse(current, target - current.now));
    current = settle(elapse(current, Math.max(0, deadline - current.now)));
    current = transition(current);
    if (current.now >= autoOffAt(current)) current = powerOff(current);
    const due = takeDueButtons(current);
    current = settle(due.actions.reduce(applyButton, due.state));
    if (current.now === target) return current;
  }
}

export function snapshot(state) {
  const current = settle(state);
  const rows = menuRows(current);
  return { screen: current.screen, now: current.now, weight: current.grossWeight - current.tareOffset,
    timerMs: current.timerMs, timerRunning: current.timerRunning, settings: { ...current.settings },
    menu: { ...current.menu, rows, page: Math.floor(current.menu.selected / 4) + 1, totalPages: Math.ceil(rows.length / 4) },
    icons: { ...current.icons }, info: { ...current.info }, held: heldButtons(current), prompt: { ...current.prompt },
    feedback: current.feedback ? { ...current.feedback } : null, tareUntil: current.tareUntil,
    shutdownUntil: current.shutdownUntil, status: current.status,
    controls: { grossWeight: current.grossWeight, pourRate: current.pourRate, pouring: current.pouring } };
}
