const names = Object.freeze(["circle", "square"]);
export const LONG_PRESS_MS = 900;
export const CHORD_MS = 500;
export const DOUBLE_CLICK_MS = 600;
export const CLICK_MS = 180;

export function initialButtons() {
  return Object.fromEntries(names.map((name) => [name, { downAt: null, longHandled: false, consumed: false, lastTapAt: null, releasedAt: null }]));
}

export function heldButtons(state) {
  return Object.fromEntries(names.map((name) => [name, state.buttons[name].downAt !== null]));
}

export function consumeHeldButtons(state) {
  return { ...state, chordAt: null, buttons: Object.fromEntries(names.map((name) =>
    [name, { ...state.buttons[name], consumed: state.buttons[name].downAt !== null || state.buttons[name].consumed }])) };
}

function chordAllowed(state) {
  return state.icons.usbPresent && ["weighing", "charging", "off"].includes(state.screen);
}

export function pressButton(state, name) {
  if (!names.includes(name) || state.buttons[name].downAt !== null) return state;
  const next = { ...state, lastActivityAt: state.now, buttons: { ...state.buttons,
    [name]: { ...state.buttons[name], downAt: state.now, longHandled: false, consumed: false } } };
  const bothHeld = names.every((button) => next.buttons[button].downAt !== null && !next.buttons[button].consumed);
  return { ...next, chordAt: bothHeld && chordAllowed(next) ? state.now : null };
}

export function releaseButton(state, name) {
  if (!names.includes(name) || state.buttons[name].downAt === null) return { state, action: null };
  const press = state.buttons[name];
  const tap = !press.longHandled && !press.consumed;
  const click = tap && state.now - press.downAt <= CLICK_MS;
  const double = click && press.lastTapAt !== null && state.now - press.lastTapAt <= DOUBLE_CLICK_MS;
  const next = { ...state, chordAt: null, buttons: { ...state.buttons,
    [name]: { downAt: null, longHandled: false, consumed: false, lastTapAt: click && !double ? state.now : null,
      releasedAt: press.consumed ? press.releasedAt : state.now } } };
  return { state: next, action: { type: tap ? "tap" : "release", name, double, consumed: press.consumed } };
}

export function nextButtonDeadline(state) {
  const chord = state.chordAt === null || !chordAllowed(state) ? Infinity : state.chordAt + CHORD_MS;
  if (["boot", "setup"].includes(state.screen)) return Infinity;
  const holds = names.map((name) => {
    const press = state.buttons[name];
    return press.downAt === null || press.longHandled || press.consumed ? Infinity : press.downAt + LONG_PRESS_MS;
  });
  return Math.min(chord, ...holds);
}

export function takeDueButtons(state) {
  if (state.chordAt !== null && state.now - state.chordAt >= CHORD_MS && chordAllowed(state)) {
    return { state: consumeHeldButtons(state), actions: [{ type: "chord" }] };
  }
  if (["boot", "setup"].includes(state.screen)) return { state, actions: [] };
  return names.reduce((result, name) => {
    const press = result.state.buttons[name];
    if (press.downAt === null || press.longHandled || press.consumed || result.state.now - press.downAt < LONG_PRESS_MS) return result;
    return { state: { ...result.state, buttons: { ...result.state.buttons, [name]: { ...press, longHandled: true } } },
      actions: [...result.actions, { type: "hold", name }] };
  }, { state, actions: [] });
}
