import { createState, dispatch, advance, snapshot, readSettings, saveSettings } from './state.mjs';
import { hydrateIcons } from './icons.mjs';
import { bindControls } from './controls.mjs';
import { createButtonInput } from './button-input.mjs';
import { createApiControls } from './api-controls.mjs';
import { connectControlApi } from './api-bridge.mjs';
import { enableControls, presentClock, presentPixels, presentState } from './view.mjs';

let state = createState(readSettings());
let renderer;
let playing = true;
let lastWallTime = null;
let lastFrame = -1;
let savedSettings = JSON.stringify(state.settings);
let failedSettings = null;
let storageError = '';
let publish = () => {};

export function getSnapshot() {
  return snapshot(state);
}

function redraw() {
  const current = snapshot(state);
  presentState(current);
  if (storageError) document.getElementById('notice').textContent = storageError;
  if (renderer) presentPixels(renderer.render(current));
  lastFrame = Math.floor(current.now / 100);
  publish();
}

function persistSettings() {
  const serialized = JSON.stringify(state.settings);
  if (serialized === savedSettings) {
    failedSettings = null;
    storageError = '';
    return;
  }
  if (serialized === failedSettings) return;
  const result = saveSettings(state.settings);
  if (result === false) {
    failedSettings = serialized;
    storageError = 'Settings could not be saved in this browser';
    return;
  }
  savedSettings = serialized;
  failedSettings = null;
  storageError = '';
}

export function send(event) {
  state = dispatch(state, event);
  persistSettings();
  redraw();
  return getSnapshot();
}

export function setPlaying(value) {
  playing = Boolean(value);
  lastWallTime = null;
  presentClock(playing);
  publish();
}

export function advanceTime(milliseconds) {
  setPlaying(false);
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 86400000) throw new RangeError('Invalid clock advance');
  state = advance(state, milliseconds);
  persistSettings();
  redraw();
  return getSnapshot();
}

function tick(wallTime) {
  if (playing && lastWallTime !== null) {
    state = advance(state, Math.max(0, wallTime - lastWallTime));
    if (Math.floor(state.now / 100) !== lastFrame) {
      persistSettings();
      redraw();
    }
  }
  lastWallTime = wallTime;
  requestAnimationFrame(tick);
}

async function initialize() {
  document.body.classList.toggle('touch', navigator.maxTouchPoints > 0);
  hydrateIcons();
  const actions = { send, getSnapshot, setPlaying, isPlaying: () => playing, advanceTime,
    buttons: createButtonInput(send, getSnapshot) };
  bindControls(actions);
  presentClock(playing);
  const { createRenderer } = await import('./renderer.mjs');
  renderer = await createRenderer();
  enableControls(renderer.metadata);
  redraw();
  publish = connectControlApi(createApiControls(actions));
  requestAnimationFrame(tick);
  return renderer.metadata;
}

export const ready = initialize();
ready.catch(error => {
  document.getElementById('notice').textContent = 'OLED renderer unavailable';
  console.error(error);
});
