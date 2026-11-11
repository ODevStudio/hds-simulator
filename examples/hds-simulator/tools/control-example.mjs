import { readFile } from 'node:fs/promises';

const connectionFile = process.argv[2];
if (!connectionFile) throw new Error('Usage: node tools/control-example.mjs /path/to/connection.json [instanceId]');
const { wsUrl, token } = JSON.parse(await readFile(connectionFile, 'utf8'));
const socket = new WebSocket(wsUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
socket.addEventListener('close', () => {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error('Control server disconnected'));
  }
  pending.clear();
});

function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Request timed out: ${method}`));
    }, 6000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timed out')), 5000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Connection failed')); }, { once: true });
  });
  await call('auth', { token, role: 'controller' });
  const { instances } = await call('instances.list');
  const instanceId = process.argv[3] || (instances.length === 1 ? instances[0].instanceId : null);
  if (!instanceId) throw new Error('Open one simulator tab, or pass an explicit instanceId');
  const control = (method, params = {}) => call(method, { ...params, instanceId });
  await control('clock.pause');
  await control('field.set', { id: 'scene', value: 'weighing' });
  await control('field.set', { id: 'weight', value: 0 });
  await control('button.press', { id: 'tare' });
  await control('field.set', { id: 'pour-rate', value: 5 });
  const before = await control('state.get');
  if (!before.snapshot.controls.pouring) await control('button.press', { id: 'pour' });
  await control('clock.advance', { ms: 2500 });
  await control('button.press', { id: 'pour' });
  const state = await control('state.get');
  console.log(JSON.stringify({ instanceId, weight: state.snapshot.weight, settings: await control('settings.get') }, null, 2));
} finally {
  socket.close();
}
