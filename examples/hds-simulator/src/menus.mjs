export const menuIds = Object.freeze(["main", "scale", "connections", "display", "power", "info"]);
export const infoScreens = Object.freeze(["status", "about", "wifiStatus", "batteryInfo", "logo", "logoSample"]);

const toggle = (id, title, setting) => Object.freeze({ id, title, setting, kind: "toggle" });
const page = (id, title, screen = id) => Object.freeze({ id, title, screen, kind: "page" });
const deferred = (id, title) => Object.freeze({ id, title, kind: "deferred" });
const back = Object.freeze({ id: "back", title: "Back", kind: "back" });

export const menuDefinitions = Object.freeze({
  main: Object.freeze([
    Object.freeze({ id: "exit", title: "Exit", kind: "exit" }),
    ...["scale", "connections", "display", "power", "info"].map((id) =>
      Object.freeze({ id, title: id[0].toUpperCase() + id.slice(1), kind: "menu" })),
  ]),
  scale: Object.freeze([
    back,
    deferred("calibrate", "Calibrate"),
    Object.freeze({ id: "drift", kind: "drift" }),
    toggle("tapTare", "2x Tap Tare", "tapTare"),
    toggle("tapTimer", "3x Tap Timer", "tapTimer"),
  ]),
  connections: Object.freeze([
    back,
    toggle("wifi", "WiFi", "wifiOnBoot"),
    toggle("heartbeat", "Heartbeat", "requireHeartbeat"),
    toggle("bleButtons", "BLE Buttons", "bleButtons"),
    page("wifiStatus", "WiFi Status"),
    deferred("wifiUpdate", "WiFi Update"),
    deferred("customBuild", "Custom Build"),
    Object.freeze({ id: "resetWifi", title: "Reset WiFi", kind: "resetWifi" }),
  ]),
  display: Object.freeze([
    back,
    toggle("flipScreen", "Flip Screen", "screenFlipped"),
    Object.freeze({ id: "timeOnTop", kind: "timeOnTop" }),
    toggle("appText", "App Text", "appTextEnabled"),
    page("logo", "Show Logo"),
  ]),
  power: Object.freeze([
    back,
    toggle("autoSleep", "Auto Sleep", "autoSleep"),
    toggle("quickBoot", "Quick Boot", "quickBoot"),
    Object.freeze({ id: "wakeOnWeight", kind: "wakeOnWeight" }),
  ]),
  info: Object.freeze([back, page("status", "Status"), page("about", "About"), page("batteryInfo", "Bat. Info")]),
});

export function isMenu(screen) {
  return menuIds.includes(screen);
}

export function driftLabel(value) {
  return value === 0 ? "Off" : value === 0.075 ? "0.075g" : `${value.toFixed(2)}g`;
}

export function menuRows(state) {
  const id = isMenu(state.screen) ? state.screen : state.menu.id;
  return menuDefinitions[id].map((item) => {
    if (item.kind === "toggle") return `${item.title} ${state.settings[item.setting] ? "x" : "o"}`;
    if (item.kind === "drift") return `Drift: ${driftLabel(state.settings.driftCompensation)}`;
    if (item.kind === "timeOnTop") return `Top: ${state.settings.timeOnTop ? "Time" : "Weight"}`;
    if (item.kind === "wakeOnWeight") return `WakeOnWeight ${["o", "2", "3", "4"][state.settings.wakeOnWeight]}`;
    return item.title;
  });
}

export function selectedMenuItem(state) {
  return menuDefinitions[state.menu.id][state.menu.selected];
}

export function openMenu(state, id) {
  return { ...state, screen: id, menu: { id, selected: 0 }, feedback: null, status: "", lastActivityAt: state.now };
}

export function navigateMenu(state, direction) {
  const count = menuDefinitions[state.menu.id].length;
  return { ...state, menu: { ...state.menu, selected: (state.menu.selected + direction + count) % count },
    lastActivityAt: state.now };
}

export function backToMain(state) {
  return { ...state, screen: "main", menu: { id: "main", selected: menuDefinitions.main.findIndex((row) => row.id === state.menu.id) },
    feedback: null, lastActivityAt: state.now };
}
