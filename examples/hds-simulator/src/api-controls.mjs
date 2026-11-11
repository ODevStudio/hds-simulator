const fieldTypes = Object.freeze({
  weight: 'number', 'pour-rate': 'number', 'ble-enabled': 'boolean', 'ble-connected': 'boolean',
  'wifi-enabled': 'boolean', 'wifi-connected': 'boolean', battery: 'number',
  'usb-present': 'boolean', charging: 'boolean', prompt: 'string', scene: 'enum',
});
const buttonIds = Object.freeze(['tare', 'pour', 'setup-boot', 'reset-defaults', 'clear-prompt',
  'show-prompt', 'play-pause', 'step', 'restart', 'view-detail', 'view-full', 'clean-view',
  'exit-clean', 'double-tap', 'triple-tap', 'circle', 'square',
  'weight-step-up', 'weight-step-down', 'pour-rate-step-up', 'pour-rate-step-down']);
const byId = id => document.getElementById(id);
const enabled = element => !element.matches(':disabled');
const fail = (message, code = -32602) => { throw Object.assign(new Error(message), { code }); };

function readField(id) {
  const element = byId(id);
  const type = fieldTypes[id];
  const number = element.valueAsNumber;
  const value = type === 'boolean' ? element.checked : type === 'number' ? Number.isFinite(number) ? number : null : element.value;
  const limits = type === 'number' ? { min: Number(element.min), max: Number(element.max), step: Number(element.step) } :
    type === 'enum' ? { options: Array.from(element.options, option => option.value) } :
      type === 'string' ? { maxLength: element.maxLength } : {};
  return { id, type, value, enabled: enabled(element), ...limits };
}

function validateField(field, value) {
  if (!field.enabled) fail(`Control is disabled: ${field.id}`, -32010);
  if (field.type === 'boolean' && typeof value !== 'boolean') fail('Expected boolean value');
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) fail('Number outside allowed range');
    const steps = (value - field.min) / field.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) fail('Number does not match field step');
  }
  if (field.type === 'enum' && !field.options.includes(value)) fail('Unknown field option');
  if (field.type === 'string' && (typeof value !== 'string' || !/^[\x20-\x7e]{0,128}$/.test(value))) fail('Expected up to 128 printable ASCII characters');
}

export function createApiControls({ getSnapshot, isPlaying, setPlaying, advanceTime, buttons }) {
  const readButtons = () => buttonIds.map(id => ({ id, enabled: enabled(byId(id)),
    ...(['circle', 'square'].includes(id) ? { held: getSnapshot().held[id] } : {}) }));
  const getState = () => ({ snapshot: getSnapshot(), ui: {
    playing: isPlaying(), view: byId('scale-window').classList.contains('detail') ? 'detail' : 'full',
    clean: document.body.classList.contains('clean'),
    fields: Object.fromEntries(Object.keys(fieldTypes).map(id => { const field = readField(id); return [id, { value: field.value, enabled: field.enabled }]; })),
    buttons: Object.fromEntries(readButtons().map(({ id, ...button }) => [id, button])),
  } });
  return {
    getState,
    cancel(controllerId) { buttons.cancel(`api:${controllerId}`); },
    cancelRemote() { buttons.cancelRemote(); },
    execute(method, params = {}) {
      if (!params || typeof params !== 'object' || Array.isArray(params)) fail('Expected parameter object');
      const allowed = method === 'field.set' ? ['id', 'value'] : method.startsWith('button.') ? ['id'] :
        method === 'clock.advance' ? ['ms'] : [];
      if (Object.keys(params).some(key => key !== 'controllerId' && !allowed.includes(key))) fail('Unknown parameter');
      if (method === 'state.get') return getState();
      if (method === 'settings.get') return getSnapshot().settings;
      if (method === 'controls.describe') return { fields: Object.keys(fieldTypes).map(readField), buttons: readButtons(), clock: { maxAdvanceMs: 86400000, stepMs: 100 } };
      if (method === 'field.set') {
        if (!Object.hasOwn(fieldTypes, params.id)) fail('Unknown field');
        const field = readField(params.id);
        validateField(field, params.value);
        const element = byId(params.id);
        if (field.type === 'boolean') element.checked = params.value;
        else element.value = String(params.value);
        element.dispatchEvent(new Event(field.type === 'number' || params.id === 'prompt' ? 'input' : 'change', { bubbles: true }));
      } else if (['button.press', 'button.down', 'button.up'].includes(method)) {
        if (!buttonIds.includes(params.id)) fail('Unknown button');
        const button = byId(params.id);
        if (!enabled(button)) fail(`Control is disabled: ${params.id}`, -32010);
        if (method !== 'button.press' && !['circle', 'square'].includes(params.id)) fail('Only physical buttons support holds');
        if (['circle', 'square'].includes(params.id)) {
          const owner = `api:${params.controllerId}`;
          if (method === 'button.press' && getSnapshot().held[params.id]) fail('Button is already held', -32011);
          const action = method === 'button.up' ? 'up' : 'down';
          if (!buttons[action](params.id, owner)) fail('Button is not owned by this controller', -32011);
          if (method === 'button.press') buttons.up(params.id, owner);
        } else {
          if (params.id === 'show-prompt' && !/^[\x20-\x7e]{1,128}$/.test(byId('prompt').value)) fail('Prompt must contain 1-128 printable ASCII characters');
          button.click();
        }
      } else if (method === 'clock.pause' || method === 'clock.resume') {
        setPlaying(method === 'clock.resume');
      } else if (method === 'clock.advance') {
        if (typeof params.ms !== 'number' || !Number.isFinite(params.ms) || params.ms < 0 || params.ms > 86400000) fail('Clock advance must be 0-86400000 milliseconds');
        advanceTime(params.ms);
      } else fail('Unknown method', -32601);
      return getState();
    },
  };
}
