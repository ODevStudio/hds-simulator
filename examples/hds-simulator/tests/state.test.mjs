import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advance, createState, defaults, dispatch, menuRows, readSettings, saveSettings, snapshot } from "../src/state.mjs";
import { SETTINGS_KEY, validateSettings } from "../src/storage.mjs";

const event = (state, type, values = {}) => dispatch(state, { type, ...values });
const ready = (settings) => advance(createState(settings), 1000);
const tap = (state, name, duration = 100) => event(advance(event(state, "buttonDown", { name }), duration), "buttonUp", { name });
const hold = (state, name, duration = 900) => event(advance(event(state, "buttonDown", { name }), duration), "buttonUp", { name });
const jump = (state, screen) => event(state, "jump", { screen });
const row = (state, index) => Array.from({ length: index }, () => 0).reduce((current) => tap(current, "circle"), state);

test("standard USB reset boots for one second, with firmware defaults and no gauge rows", () => {
  const initial = createState();
  assert.equal(initial.screen, "boot");
  assert.equal(advance(initial, 999).screen, "boot");
  const state = advance(initial, 1000);
  const frame = snapshot(state);
  assert.equal(frame.screen, "weighing");
  assert.deepEqual(frame.settings, defaults);
  assert.equal(frame.icons.usbPresent, true);
  assert.equal(frame.icons.bleEnabled, true);
  assert.equal(frame.icons.wifiEnabled, false);
  assert.equal(frame.controls.grossWeight, 0);
  assert.equal(frame.controls.pourRate, 3);
  assert.equal(frame.timerMs, 0);
  assert.equal(frame.timerRunning, false);
  assert.deepEqual(menuRows(jump(state, "power")), ["Back", "Auto Sleep x", "Quick Boot o", "WakeOnWeight o"]);
  assert.deepEqual(menuRows(jump(state, "display")), ["Back", "Flip Screen o", "Top: Weight", "App Text o", "Show Logo"]);
});

test("setup boot consumes held buttons and does not tare or start the timer on release", () => {
  const pressed = event(event(createState(), "buttonDown", { name: "circle" }), "buttonDown", { name: "square" });
  const setup = advance(pressed, 1000);
  assert.equal(setup.screen, "setup");
  assert.equal(advance(setup, 999).screen, "setup");
  const main = event(event(advance(setup, 1000), "buttonUp", { name: "circle" }), "buttonUp", { name: "square" });
  assert.equal(main.screen, "main");
  assert.equal(main.menu.selected, 0);
  assert.equal(main.timerRunning, false);
  assert.equal(main.tareUntil, 0);
  assert.equal(advance(event(ready(), "restart", { setup: true }), 2000).screen, "main");
});

test("USB chord opens Main at 500ms, while battery-only holds do not", () => {
  const both = (state) => event(event(state, "buttonDown", { name: "circle" }), "buttonDown", { name: "square" });
  const pending = both(ready());
  assert.equal(advance(pending, 499).screen, "weighing");
  const main = advance(pending, 500);
  assert.equal(main.screen, "main");
  assert.equal(event(event(main, "buttonUp", { name: "circle" }), "buttonUp", { name: "square" }).menu.selected, 0);
  assert.equal(advance(both(event(ready(), "setUsb", { present: false })), 1500).screen, "weighing");
});

test("menu navigation acts on release, wraps, and holds suppress release", () => {
  const main = jump(ready(), "main");
  const down = event(main, "buttonDown", { name: "circle" });
  assert.equal(down.menu.selected, 0);
  assert.equal(event(down, "buttonUp", { name: "circle" }).menu.selected, 1);
  const previous = hold(main, "circle");
  assert.equal(previous.menu.selected, 5);
  assert.equal(previous.screen, "main");
  const scale = tap(row(main, 1), "square");
  assert.equal(scale.screen, "scale");
  assert.equal(scale.menu.selected, 0);
  const returned = hold(row(scale, 2), "square");
  assert.equal(returned.screen, "main");
  assert.equal(returned.menu.selected, 1);
  const exiting = hold(returned, "square");
  assert.equal(snapshot(exiting).feedback.text, "Exit Menu");
  assert.equal(advance(exiting, 1000).screen, "weighing");
});

test("default pouring adds three grams per simulated second", () => {
  const pouring = event(ready(), "togglePour");
  assert.equal(snapshot(advance(pouring, 2000)).weight, 6);
  assert.equal(createState().pourRate, 3);
});

test("gross weight, tare and pouring use the simulation clock without mutating previous state", () => {
  const base = event(ready(), "setWeight", { value: 250 });
  const copy = structuredClone(base);
  const tared = tap(base, "circle");
  assert.equal(snapshot(tared).weight, 0);
  const pouring = event(event(tared, "setPourRate", { value: 12.5 }), "togglePour");
  const later = advance(pouring, 2400);
  assert.equal(snapshot(later).weight, 30);
  assert.equal(snapshot(later).controls.grossWeight, 280);
  assert.equal(snapshot(advance(event(later, "togglePour"), 1000)).weight, 30);
  assert.deepEqual(base, copy);
  assert.equal(snapshot(event(later, "setWeight", { value: -12 })).weight, -262);
});

test("completed surface taps apply enabled local actions, including with BLE Buttons Off", () => {
  const settings = { ...defaults, tapTare: true, tapTimer: true };
  const connected = event(event(ready(settings), "setConnection", { connected: true }), "setWeight", { value: 80 });
  const tared = event(connected, "scaleTap", { count: 2 });
  assert.equal(snapshot(tared).weight, 0);
  assert.equal(tared.settings.bleButtons, false);
  const running = event(event(tared, "scaleTap", { count: 3 }), "setWeight", { value: 100 });
  assert.equal(running.timerRunning, true);
  assert.equal(snapshot(event(running, "scaleTap", { count: 2 })).weight, 20);
  const stopped = event(advance(running, 1500), "scaleTap", { count: 3 });
  assert.equal(stopped.timerRunning, false);
  assert.equal(stopped.timerMs, 1500);
  const reset = event(stopped, "scaleTap", { count: 3 });
  assert.equal(reset.timerMs, 0);
  assert.equal(reset.timerRunning, false);
  assert.equal(snapshot(event(reset, "scaleTap", { count: 2 })).weight, 0);
});

test("surface taps respect feature flags, screen ownership and physical-button priority", () => {
  const ignored = (state, count = 3) => assert.deepEqual(snapshot(event(state, "scaleTap", { count })), snapshot(state));
  for (const count of [2, 3]) ignored(ready(), count);
  const settings = { ...defaults, tapTare: true, tapTimer: true };
  const state = ready(settings);
  for (const count of [0, 1, 4, 2.5, "3", null, NaN]) ignored(state, count);
  ignored(createState(settings));
  ignored(jump(state, "main"));
  ignored(advance(tap(tap(state, "circle"), "circle"), 1000));
  ignored(event(state, "buttonDown", { name: "square" }));
  const released = tap(state, "circle", 250);
  ignored(advance(released, 600));
  assert.equal(event(advance(released, 601), "scaleTap", { count: 3 }).timerRunning, true);
  const exited = advance(hold(jump(state, "main"), "square"), 1000);
  ignored(advance(exited, 1000));
  assert.equal(event(advance(exited, 1001), "scaleTap", { count: 3 }).timerRunning, true);
  const connected = event(state, "setConnection", { connected: true });
  const warning = tap(tap(connected, "circle"), "circle");
  ignored(warning);
  assert.equal(event(advance(warning, 3000), "scaleTap", { count: 3 }).timerRunning, true);
});

test("timer follows Start, Stop, Reset and keeps running while menus are open", () => {
  const started = tap(ready(), "square");
  const stopped = tap(advance(started, 1500), "square");
  assert.equal(stopped.timerRunning, false);
  assert.equal(stopped.timerMs, 1600);
  const reset = tap(advance(stopped, 700), "square");
  assert.equal(reset.timerMs, 0);
  assert.equal(reset.timerRunning, false);
  const running = event(ready(), "timerCycle");
  assert.equal(advance(jump(running, "main"), 2000).timerMs, 2000);
  const subsecond = event(advance(running, 200), "timerCycle");
  assert.equal(event(subsecond, "timerCycle").timerRunning, true);
  assert.equal(tap(tap(ready(), "square", 250), "square", 250).screen, "weighing");
  assert.equal(tap(tap(ready(), "square"), "square", 250).screen, "weighing");
});

test("BLE Buttons controls local short presses without blocking App Text cancellation", () => {
  const connected = event(event(ready({ ...defaults, appTextEnabled: true }), "setWeight", { value: 50 }), "setConnection", { connected: true });
  assert.equal(snapshot(tap(connected, "circle")).weight, 50);
  assert.equal(tap(connected, "square").timerRunning, false);
  const prompt = event(connected, "setPrompt", { text: "Add gin" });
  assert.equal(snapshot(prompt).prompt.visible, true);
  const cancelled = hold(prompt, "circle");
  assert.equal(cancelled.prompt.cancelled, true);
  assert.equal(snapshot(cancelled).prompt.visible, false);
  const allowed = event(ready({ ...defaults, bleButtons: true }), "setConnection", { connected: true });
  assert.equal(tap(allowed, "square").timerRunning, true);
});

test("BLE connection prevents auto-off and Square confirms a blocked shutdown on press", () => {
  const connected = event(event(ready(), "setUsb", { present: false }), "setConnection", { connected: true });
  const later = advance(connected, 1000000);
  assert.equal(later.screen, "weighing");
  const disconnected = event(later, "setConnection", { connected: false });
  assert.equal(advance(disconnected, 899999).screen, "weighing");
  assert.equal(advance(disconnected, 900000).screen, "off");
  const usb = event(ready({ ...defaults, quickBoot: true }), "setConnection", { connected: true });
  const warning = tap(tap(usb, "circle"), "circle");
  assert.equal(warning.shutdownUntil, warning.now + 3000);
  const confirmed = event(warning, "buttonDown", { name: "square" });
  assert.equal(confirmed.screen, "off");
  assert.equal(confirmed.settings.bleButtons, false);
  const released = event(advance(confirmed, 1000), "buttonUp", { name: "square" });
  assert.equal(released.screen, "charging");
  assert.equal(released.timerRunning, false);
  assert.equal(released.tareUntil, 0);
});

test("App Text resumes at the exact shutdown-warning deadline for any advance partition", () => {
  const connected = event(ready({ ...defaults, appTextEnabled: true }), "setConnection", { connected: true });
  const shown = event(connected, "setPrompt", { text: "Carpano Antica Sweet Vermouth: 31g" });
  const warning = tap(tap(shown, "circle"), "circle");
  assert.equal(warning.prompt.visible, false);
  const bulk = advance(warning, 4000);
  assert.equal(bulk.prompt.startedAt, warning.shutdownUntil);
  assert.deepEqual(bulk, advance(advance(warning, 3000), 1000));
});

test("App Text validates ASCII and size, preserves repeated text, and resets visibility cycles", () => {
  const connected = event(ready({ ...defaults, appTextEnabled: true }), "setConnection", { connected: true });
  const shown = event(connected, "setPrompt", { text: "A".repeat(128) });
  assert.equal(snapshot(shown).prompt.visible, true);
  const later = event(advance(shown, 3200), "setPrompt", { text: shown.prompt.text });
  assert.equal(later.prompt.startedAt, shown.prompt.startedAt);
  for (const text of ["", "A".repeat(129), "caf\u00e9", "Gin\n", null]) {
    assert.equal(event(later, "setPrompt", { text }).prompt.text, shown.prompt.text);
  }
  const hidden = jump(later, "main");
  assert.equal(snapshot(hidden).prompt.visible, false);
  const visible = jump(advance(hidden, 1000), "weighing");
  assert.equal(visible.prompt.startedAt, visible.now);
  assert.equal(event(visible, "setWeight", { value: 1500 }).prompt.visible, true);
  assert.equal(event(visible, "setWeight", { value: 1500.1 }).prompt.visible, false);
  assert.equal(event(visible, "clearPrompt").prompt.active, false);
});

test("cancelled App Text stays blocked through Clear and Off/On until a real reconnect edge", () => {
  const connected = event(ready({ ...defaults, appTextEnabled: true }), "setConnection", { connected: true });
  const cancelled = hold(event(connected, "setPrompt", { text: "Gin" }), "circle");
  const cleared = event(cancelled, "clearPrompt");
  const repeated = event(event(cleared, "setConnection", { connected: true }), "setBle", { enabled: true });
  assert.equal(event(repeated, "setPrompt", { text: "Rum" }).prompt.active, false);
  const off = tap(row(jump(repeated, "display"), 3), "square");
  const on = tap(off, "square");
  assert.equal(on.settings.appTextEnabled, true);
  assert.equal(event(on, "setPrompt", { text: "Rum" }).prompt.active, false);
  const reconnected = event(event(on, "setConnection", { connected: false }), "setConnection", { connected: true });
  assert.equal(event(reconnected, "setPrompt", { text: "Rum" }).prompt.active, true);
});

test("settings actions mirror labels, cycle drift, and keep deferred hardware outside OLED feedback", () => {
  const display = tap(row(jump(ready(), "display"), 1), "square");
  assert.equal(display.settings.screenFlipped, true);
  assert.equal(menuRows(display)[1], "Flip Screen x");
  assert.equal(display.feedback.text, "Flip Screen");
  const drift = tap(row(jump(display, "scale"), 2), "square");
  assert.equal(drift.settings.driftCompensation, 0.075);
  const wake = tap(row(jump(drift, "power"), 3), "square");
  assert.equal(wake.settings.wakeOnWeight, 0);
  assert.equal(wake.feedback.text2, "Please calibrate");
  const deferred = tap(row(jump(ready(), "scale"), 1), "square");
  assert.equal(deferred.screen, "scale");
  assert.equal(deferred.feedback, null);
  assert.match(deferred.status, /requires hardware/);
});

test("WiFi boot changes take effect on simulated restart when leaving the menu", () => {
  const saved = tap(row(jump(ready(), "connections"), 1), "square");
  assert.equal(saved.settings.wifiOnBoot, true);
  assert.equal(saved.icons.wifiEnabled, false);
  const main = hold(saved, "square");
  const exit = hold(main, "square");
  const boot = advance(exit, 1000);
  assert.equal(boot.screen, "boot");
  assert.equal(boot.icons.wifiEnabled, true);
  assert.equal(advance(boot, 1000).screen, "weighing");
});

test("information pages swallow Circle, Square dismisses, legacy Battery Info exits on Circle", () => {
  const status = tap(row(jump(ready(), "info"), 1), "square");
  assert.equal(status.screen, "status");
  assert.equal(tap(status, "circle").screen, "status");
  assert.equal(hold(status, "square").screen, "info");
  const battery = tap(row(jump(ready(), "info"), 3), "square");
  assert.equal(battery.screen, "batteryInfo");
  assert.equal(tap(battery, "square").screen, "batteryInfo");
  assert.equal(tap(battery, "circle").screen, "info");
  const logo = tap(row(jump(ready(), "display"), 4), "square");
  const back = tap(logo, "square");
  assert.equal(tap(back, "square").screen, "logoSample");
});

test("input cancellation cannot trigger a short action or leave a pending chord", () => {
  const down = event(ready(), "buttonDown", { name: "square" });
  const cancelled = event(down, "cancelButtons");
  assert.deepEqual(snapshot(cancelled).held, { circle: false, square: false });
  assert.equal(event(cancelled, "buttonUp", { name: "square" }).timerRunning, false);
  assert.equal(advance(cancelled, 2000).screen, "weighing");
  const chord = event(down, "buttonDown", { name: "circle" });
  const jumped = jump(advance(chord, 200), "display");
  assert.equal(advance(jumped, 1000).screen, "display");
  assert.deepEqual(snapshot(jumped).held, { circle: false, square: false });
});

test("time stepping is deterministic across boot and chord deadlines, and ignores invalid controls", () => {
  const base = event(event(createState(), "setWeight", { value: 100 }), "togglePour");
  assert.deepEqual(advance(base, 2300), advance(advance(base, 1000), 1300));
  const both = event(event(ready(), "buttonDown", { name: "circle" }), "buttonDown", { name: "square" });
  assert.deepEqual(advance(both, 1300), advance(advance(both, 500), 800));
  for (const value of [NaN, Infinity, "2", null]) {
    assert.equal(event(base, "setWeight", { value }).grossWeight, base.grossWeight);
    assert.equal(event(base, "setPourRate", { value }).pourRate, base.pourRate);
    assert.equal(advance(base, value), base);
  }
  assert.equal(advance(base, -1), base);
  assert.equal(event(base, "setWeight", { value: 10001 }).grossWeight, base.grossWeight);
  assert.equal(event(base, "setPourRate", { value: -1 }).pourRate, base.pourRate);
  assert.equal(event(base, "setPourRate", { value: 1001 }).pourRate, base.pourRate);
  assert.equal(advance(event(base, "setPourRate", { value: 1000 }), 100000).grossWeight, 10000);
});

test("settings persistence validates an isolated namespace and never clears unrelated keys", () => {
  const values = new Map([["other-app", "untouched"]]);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(saveSettings({ ...defaults, autoSleep: false, unknown: "ignored" }, storage), true);
  assert.equal(readSettings(storage).autoSleep, false);
  assert.equal(values.get("other-app"), "untouched");
  assert.deepEqual([...values.keys()].sort(), [SETTINGS_KEY, "other-app"].sort());
  values.set(SETTINGS_KEY, "{broken");
  assert.deepEqual(readSettings(storage), defaults);
  values.set(SETTINGS_KEY, JSON.stringify({ version: 99, settings: { quickBoot: true } }));
  assert.deepEqual(readSettings(storage), defaults);
  assert.deepEqual(validateSettings({ autoSleep: "false", driftCompensation: NaN, wakeOnWeight: 4 }), defaults);
  assert.deepEqual(readSettings({ getItem() { throw Error("denied"); } }), defaults);
  assert.equal(saveSettings(defaults, { setItem() { throw Error("denied"); } }), false);
});

test("standard menu rows and settings defaults match firmware declarations and visible pointer arrays", () => {
  const source = readFileSync(new URL("../../../include/menu.h", import.meta.url), "utf8").replace(/\r/g, "");
  const storage = readFileSync(new URL("../../../include/storage.h", import.meta.url), "utf8");
  const settingLinks = [
    ["screenFlipped", "KEY_SCREEN_FLIP", "b_screenFlipped"],
    ["timeOnTop", "KEY_TIME_ON_TOP", "b_timeOnTop"],
    ["appTextEnabled", "KEY_APP_TEXT", "appTextIsEnabled()"],
    ["wifiOnBoot", "KEY_WIFI_BOOT", "b_wifiOnBoot"],
    ["requireHeartbeat", "KEY_HEARTBEAT", "b_requireHeartBeat"],
    ["bleButtons", "KEY_BTN_CONN", "b_btnFuncWhileConnected"],
    ["autoSleep", "KEY_AUTO_SLEEP", "b_autoSleep"],
    ["quickBoot", "KEY_QUICK_BOOT", "b_quickBoot"],
    ["tapTare", "KEY_TAP_TARE", "b_tapTareEnabled"],
    ["tapTimer", "KEY_TAP_TIMER", "b_tapTimerEnabled"],
    ["driftCompensation", "KEY_DRIFT_MAX", "f_maxDriftCompensation"],
    ["wakeOnWeight", "KEY_WOW_INTERVAL", "i_wow_interval"],
  ];
  const ensured = storage.match(/inline bool storageEnsureDefaults\(\) \{([\s\S]*?)\n\}/)[1];
  const settings = Object.fromEntries(settingLinks.map(([key, firmwareKey]) => {
    const match = ensured.match(new RegExp(`storageEnsure(?:Bool|Float|Int)\\(${firmwareKey},\\s*(true|false|[\\d.]+f?)\\)`));
    assert.ok(match, firmwareKey);
    return [key, match[1] === "true" ? true : match[1] === "false" ? false : Number(match[1].replace(/f$/, ""))];
  }));
  assert.deepEqual(defaults, settings);
  const declarations = new Map([...source.matchAll(/^const Menu (menu\w+) = \{\s*("[^"]*"|menu\w+),/gm)]
    .map((match) => [match[1], match[2]]));
  const labels = new Map([...source.matchAll(/^char (menu\w+)\[[^\]]*\] = ("[^"]*");/gm)]
    .map((match) => [match[1], JSON.parse(match[2])]));
  const refresh = source.match(/void refreshMenuRows\(\) \{([\s\S]*?)\n\}/)[1];
  const toggles = new Map([...refresh.matchAll(/updateToggleLabel\((menu\w+), (.*?)\);/g)]
    .map((match) => [match[1], match[2]]));
  const conditions = {
    "#if HDS_FEATURE_WIFI": true,
    "#if HDS_FEATURE_PULL_OTA": true,
    "#if HDS_FEATURE_WIFI && HDS_FEATURE_PULL_OTA": true,
    "#if HDS_ENABLE_GRINDER": false,
    "#if HDS_ENABLE_ENERGY_MENU": false,
    "#ifdef ADS1232ADC": true,
    "#ifdef BUZZER": false,
  };
  for (const id of ["main", "scale", "connections", "display", "power", "info"]) {
    const body = source.match(new RegExp(`const Menu \\*const ${id}Menu\\[\\] = \\{([\\s\\S]*?)\\};`))[1];
    const visible = body.split("\n").reduce((result, line) => {
      const directive = line.trim();
      if (/^#(?:if|ifdef)\b/.test(directive)) {
        assert.ok(Object.hasOwn(conditions, directive), directive);
        return { ...result, stack: [...result.stack, result.stack.at(-1) && conditions[directive]] };
      }
      if (directive === "#endif") return { ...result, stack: result.stack.slice(0, -1) };
      assert.ok(!directive.startsWith("#"), directive);
      return result.stack.at(-1) ? { ...result, lines: [...result.lines, line] } : result;
    }, { stack: [true], lines: [] });
    assert.equal(visible.stack.length, 1);
    const omitted = id === "connections" ? source.match(/return getMenuSize\(connectionsMenu\) - \(customBuildRelinkAvailable\(\) \? 0 : (\d+)\);/)[1] :
      id === "power" ? source.match(/return getMenuSize\(powerMenu\) - \(b_hasFuelGauge \? 0 : (\d+)\);/)[1] : 0;
    const pointers = [...visible.lines.join("\n").matchAll(/&(menu\w+)/g)];
    const rows = (omitted ? pointers.slice(0, -Number(omitted)) : pointers).map((match) => {
      const name = declarations.get(match[1]);
      assert.ok(name, match[1]);
      if (name.startsWith('"')) return JSON.parse(name);
      const label = labels.get(name);
      assert.equal(typeof label, "string", name);
      const toggle = toggles.get(name);
      if (!toggle) return label;
      const link = settingLinks.find(([, , variable]) => variable === toggle);
      assert.ok(link, toggle);
      return label.slice(0, -1) + (settings[link[0]] ? "x" : "o");
    });
    const frame = snapshot(jump(ready(settings), id));
    assert.deepEqual(frame.menu.rows, rows, id);
    assert.equal(frame.menu.totalPages, Math.ceil(rows.length / 4), id);
  }
  assert.match(source, /const int linesPerPage =\s*4;/);
});
