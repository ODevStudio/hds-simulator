import { setCleanView, setView } from './view.mjs';
import { bindNumberControl } from './number-controls.mjs';

const byId = id => document.getElementById(id);

export function bindControls({ send, setPlaying, isPlaying, advanceTime, buttons }) {
  byId('control-form').addEventListener('submit', event => event.preventDefault());
  bindNumberControl('weight', 'setWeight', send);
  bindNumberControl('pour-rate', 'setPourRate', send);
  const commands = {
    tare: { type: 'tare' },
    pour: { type: 'togglePour' },
    restart: { type: 'restart' },
    'setup-boot': { type: 'restart', setup: true },
    'reset-defaults': { type: 'resetDefaults' },
    'clear-prompt': { type: 'clearPrompt' },
    'double-tap': { type: 'scaleTap', count: 2 },
    'triple-tap': { type: 'scaleTap', count: 3 },
  };
  for (const [id, command] of Object.entries(commands)) byId(id).addEventListener('click', () => send(command));
  const switches = {
    'ble-enabled': ['setBle', 'enabled'],
    'ble-connected': ['setConnection', 'connected'],
    'wifi-enabled': ['setWifi', 'enabled'],
    'wifi-connected': ['setWifi', 'connected'],
    'usb-present': ['setUsb', 'present'],
    charging: ['setUsb', 'charging'],
  };
  for (const [id, [type, field]] of Object.entries(switches)) byId(id).addEventListener('change', event => send({ type, [field]: event.target.checked }));
  byId('battery').addEventListener('input', event => send({ type: 'setBattery', percent: Number(event.target.value) }));
  byId('scene').addEventListener('change', event => send({ type: 'jump', screen: event.target.value }));
  byId('show-prompt').addEventListener('click', () => send({ type: 'setPrompt', text: byId('prompt').value }));
  byId('prompt').addEventListener('input', event => { byId('prompt-length').textContent = `${event.target.value.length} / 128`; });
  byId('play-pause').addEventListener('click', () => setPlaying(!isPlaying()));
  byId('step').addEventListener('click', () => advanceTime(100));
  byId('view-detail').addEventListener('click', () => setView('detail'));
  byId('view-full').addEventListener('click', () => setView('full'));
  byId('clean-view').addEventListener('click', () => setCleanView(true));
  byId('exit-clean').addEventListener('click', () => setCleanView(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setCleanView(false); });
  bindButtons(buttons);
}

function bindButtons(buttons) {
  const pointerIds = new Map();
  const keys = new Map();
  const down = name => buttons.down(name, 'local');
  const up = name => buttons.up(name, 'local');
  const cancel = () => {
    pointerIds.clear();
    keys.clear();
    buttons.cancel('local');
  };
  for (const name of ['circle', 'square']) {
    const button = byId(name);
    button.addEventListener('pointerdown', event => {
      if (button.disabled || event.button !== 0 || pointerIds.has(name)) return;
      event.preventDefault();
      pointerIds.set(name, event.pointerId);
      button.setPointerCapture(event.pointerId);
      down(name);
    });
    button.addEventListener('pointerup', event => {
      if (pointerIds.get(name) !== event.pointerId) return;
      event.preventDefault();
      pointerIds.delete(name);
      up(name);
    });
    button.addEventListener('pointercancel', cancel);
    button.addEventListener('lostpointercapture', event => { if (pointerIds.get(name) === event.pointerId) cancel(); });
    button.addEventListener('click', event => {
      if (event.detail !== 0 || button.disabled || pointerIds.has(name) || Array.from(keys.values()).includes(name)) return;
      down(name);
      up(name);
    });
    button.addEventListener('keydown', event => {
      if ([' ', 'Enter'].includes(event.key) && !event.repeat && !keys.has(event.code)) {
        event.preventDefault();
        keys.set(event.code, name);
        down(name);
      }
    });
  }
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const name = event.code === 'KeyC' ? 'circle' : event.code === 'KeyS' ? 'square' : null;
    if (!name || byId(name).disabled || keys.has(event.code)) return;
    event.preventDefault();
    keys.set(event.code, name);
    down(name);
  });
  document.addEventListener('keyup', event => {
    const name = keys.get(event.code);
    if (!name) return;
    event.preventDefault();
    keys.delete(event.code);
    up(name);
  });
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
}
