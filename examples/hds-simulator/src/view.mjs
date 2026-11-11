import { setIcon } from './icons.mjs';
import { menuIds } from './menus.mjs';
import { updateNumberButtons } from './number-controls.mjs';

const element = id => document.getElementById(id);
const timecode = milliseconds => {
  const time = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(time / 3600000);
  const minutes = Math.floor(time / 60000) % 60;
  const seconds = Math.floor(time / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${Math.floor(time / 100) % 10}`;
};

function inputValue(id, value) {
  const input = element(id);
  if (document.activeElement !== input && input.value !== String(value)) input.value = value;
}

function checked(id, value) {
  element(id).checked = Boolean(value);
}

export function presentClock(playing) {
  const button = element('play-pause');
  const action = playing ? 'Pause simulation' : 'Resume simulation';
  button.setAttribute('aria-label', action);
  button.title = action;
  setIcon(button.querySelector('[data-icon]'), playing ? 'Pause' : 'Play');
}

export function presentPixels(pixels) {
  if (pixels.length !== 8192) throw new Error('Invalid OLED frame dimensions');
  const canvas = element('oled');
  const context = canvas.getContext('2d', { alpha: false });
  const image = context.createImageData(128, 64);
  for (let index = 0; index < pixels.length; index++) {
    const mountedPixel = pixels[pixels.length - index - 1];
    const lit = mountedPixel !== 0;
    image.data[index * 4] = lit ? 186 : 40;
    image.data[index * 4 + 1] = lit ? 216 : 46;
    image.data[index * 4 + 2] = lit ? 239 : 54;
    image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export function presentState(state) {
  const icons = state.icons;
  element('sim-time').value = timecode(state.now);
  element('net-weight').value = `${state.weight.toFixed(1)} g`;
  inputValue('weight', state.controls.grossWeight.toFixed(1));
  inputValue('pour-rate', state.controls.pourRate);
  updateNumberButtons();
  element('pour-label').textContent = state.controls.pouring ? 'Stop pouring' : 'Start pouring';
  element('pour').classList.toggle('active', state.controls.pouring);
  element('tare').disabled = state.screen !== 'weighing';
  element('double-tap').disabled = !state.settings.tapTare || state.screen !== 'weighing' || state.timerRunning;
  element('triple-tap').disabled = !state.settings.tapTimer || state.screen !== 'weighing';
  checked('ble-enabled', icons.bleEnabled);
  checked('ble-connected', icons.bleConnected);
  checked('wifi-enabled', icons.wifiEnabled);
  checked('wifi-connected', icons.wifiConnected);
  checked('usb-present', icons.usbPresent);
  checked('charging', icons.charging);
  element('ble-connected').disabled = !icons.bleEnabled;
  element('wifi-connected').disabled = !icons.wifiEnabled;
  element('charging').disabled = !icons.usbPresent;
  inputValue('battery', icons.batteryPercent);
  element('battery-value').value = `${Math.round(icons.batteryPercent)}%`;
  element('notice').textContent = state.status || '';
  const promptState = element('app-text-state');
  const cancelled = Boolean(state.prompt.cancelled);
  promptState.textContent = !state.settings.appTextEnabled ? 'Off' : cancelled ? 'Cancelled' : 'On';
  promptState.classList.toggle('enabled', state.settings.appTextEnabled && !cancelled);
  element('show-prompt').disabled = !state.settings.appTextEnabled || !icons.bleConnected || cancelled;
  element('show-prompt').title = !state.settings.appTextEnabled ? 'App Text is off' : !icons.bleConnected ? 'No app connected' : cancelled ? 'App Text cancelled for this session' : 'Show App Text';
  for (const name of ['circle', 'square']) element(name).classList.toggle('is-held', Boolean(state.held[name]));
  const menu = state.menu;
  const category = menu.id;
  const scene = menuIds.includes(state.screen) ? category : ['boot', 'weighing'].includes(state.screen) ? state.screen : category;
  if (Array.from(element('scene').options).some(option => option.value === scene)) element('scene').value = scene;
  const label = menuIds.includes(state.screen) ? `${category} / ${menu.page}` : state.screen.replace(/([a-z])([A-Z])/g, '$1 $2');
  element('screen-label').textContent = label.toUpperCase();
  element('timer-reading').textContent = `${state.timerRunning ? 'Timer running' : 'Timer stopped'} / ${timecode(state.timerMs)}`;
  const selected = menu.rows[menu.selected] || '';
  element('oled').setAttribute('aria-label', menuIds.includes(state.screen) ? `HDS ${category} menu, ${selected}` : `HDS ${state.screen}, ${state.weight.toFixed(1)} grams`);
}

export function enableControls(metadata) {
  element('controls-fieldset').disabled = false;
  for (const id of ['play-pause', 'step', 'restart', 'scene', 'circle', 'square']) element(id).disabled = false;
  element('renderer-version').textContent = `U8g2 ${metadata?.u8g2Version || '2.36.18'} / 6f2ac69`;
}

export function setView(mode) {
  const detail = mode === 'detail';
  element('scale-window').classList.toggle('detail', detail);
  for (const [id, selected] of [['view-detail', detail], ['view-full', !detail]]) {
    element(id).classList.toggle('selected', selected);
    element(id).setAttribute('aria-pressed', String(selected));
  }
}

export function setCleanView(clean) {
  document.body.classList.toggle('clean', clean);
}
