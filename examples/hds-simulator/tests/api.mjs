import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startServer } from '../server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hds-simulator-api-'));
const connectionFile = path.join(temporary, 'connection.json');
const errors = [];
const clients = new Set();
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };

class Client {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    this.waiters = new Set();
    this.events = new EventEmitter();
    this.sequence = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (Object.hasOwn(message, 'id')) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
        else pending.resolve(message.result);
      } else this.events.emit('notification', message);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Control connection closed'));
      }
      this.pending.clear();
      for (const cancel of [...this.waiters]) cancel();
    });
  }

  static async connect(url, token) {
    const socket = new WebSocket(url);
    const client = new Client(socket);
    clients.add(client);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Cannot open control connection')), { once: true });
    });
    await client.call('auth', { token, role: 'controller' });
    return client;
  }

  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Request timed out: ${method}`)); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  notification(method, predicate = () => true, timeout = 8000) {
    const promise = new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.events.off('notification', listen); this.waiters.delete(cancel); };
      const cancel = () => { cleanup(); reject(new Error('Control connection closed')); };
      const listen = message => {
        if (message.method !== method || !predicate(message.params)) return;
        cleanup();
        resolve(message.params);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Notification timed out: ${method}`)); }, timeout);
      this.waiters.add(cancel);
      this.events.on('notification', listen);
    });
    promise.catch(() => {});
    return promise;
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise(resolve => { this.socket.addEventListener('close', resolve, { once: true }); this.socket.close(); });
    clients.delete(this);
  }
}

let server;
let browser;
try {
  server = await startServer({ port: 0, connectionFile });
  const origin = new URL(server.url);
  check(origin.hostname === '127.0.0.1' && origin.protocol === 'http:', 'Ephemeral server is loopback-only');
  const configResponse = await fetch(new URL('/api/config', origin));
  check(configResponse.ok, 'Browser configuration is available');
  const config = await configResponse.json();
  check(config.token === server.token && config.protocolVersion === 1, 'Configuration identifies this authenticated server');
  check(JSON.parse(await fs.readFile(connectionFile, 'utf8')).token === server.token, 'Temporary discovery file matches this server');
  const first = await Client.connect(server.wsUrl, config.token);
  await first.call('subscribe');
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const openPage = async () => {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(server.url);
    return page;
  };
  const firstRegistered = first.notification('instances.changed', params => params.instances?.length === 1);
  const page = await openPage();
  await firstRegistered;
  const listed = (await first.call('instances.list')).instances;
  check(listed.length === 1 && typeof listed[0].instanceId === 'string', 'One real browser instance is discoverable');
  const instanceId = listed[0].instanceId;
  const call = (method, params = {}, target = instanceId) => first.call(method, { ...params, instanceId: target });
  const press = (id, target) => call('button.press', { id }, target);
  const field = (id, value, target) => call('field.set', { id, value }, target);
  const step = ms => call('clock.advance', { ms });
  const current = () => call('state.get');
  const noMutation = async (method, params, code) => {
    const before = await current();
    await assert.rejects(call(method, params), error => typeof error.code === 'number' && (code === undefined || error.code === code));
    assert.deepEqual(await current(), before, `Rejected ${method} must not mutate browser state`);
    checks++;
  };

  await call('clock.pause');
  await press('reset-defaults');
  check((await step(1000)).snapshot.screen === 'weighing', 'API reset and exact clock advance complete boot');
  const described = await call('controls.describe');
  const discoveredIds = [...described.fields, ...described.buttons].map(control => control.id).sort();
  const domIds = await page.locator('input[id], textarea[id], select[id], button[id]').evaluateAll(elements => elements.map(element => element.id).sort());
  assert.deepEqual(discoveredIds, domIds, 'Every interactive DOM control is discoverable through the API');
  checks++;
  check(described.clock.stepMs === 100 && described.clock.maxAdvanceMs === 86400000, 'Clock limits are discoverable');
  check(described.fields.find(control => control.id === 'pour-rate').value === 3 && (await current()).snapshot.controls.pourRate === 3, 'Default pour rate is 3 g/s');
  for (const id of ['weight-step-up', 'weight-step-down', 'pour-rate-step-up', 'pour-rate-step-down']) {
    check(described.buttons.some(control => control.id === id && control.enabled), `${id} is discoverable and enabled`);
  }
  for (const [id, key, start, increment, min, max] of [
    ['weight', 'grossWeight', 12.3, 0.1, -10000, 10000],
    ['pour-rate', 'pourRate', 3, 1, 0, 1000],
  ]) {
    const up = `${id}-step-up`;
    const down = `${id}-step-down`;
    await field(id, start);
    check(Math.abs((await press(up)).snapshot.controls[key] - start - increment) < 0.000001, `${up} increments once`);
    check(Math.abs((await press(down)).snapshot.controls[key] - start) < 0.000001, `${down} decrements once`);
    const lower = await field(id, min);
    check(!lower.ui.buttons[down].enabled && lower.ui.buttons[up].enabled, `${id} lower limit disables only decrement`);
    await noMutation('button.press', { id: down }, -32010);
    check(Math.abs((await press(up)).snapshot.controls[key] - min - increment) < 0.000001, `${id} can step away from lower limit`);
    const upper = await field(id, max);
    check(!upper.ui.buttons[up].enabled && upper.ui.buttons[down].enabled, `${id} upper limit disables only increment`);
    await noMutation('button.press', { id: up }, -32010);
    check(Math.abs((await press(down)).snapshot.controls[key] - max + increment) < 0.000001, `${id} can step away from upper limit`);
    await field(id, start);
    await noMutation('button.down', { id: up }, -32602);
    await noMutation('button.up', { id: down }, -32602);
    await page.locator(`#${id}`).fill('');
    const draft = await current();
    check(draft.snapshot.controls[key] === start && draft.ui.fields[id].value === null, `${id} empty draft preserves committed state and reads as null`);
    check(!draft.ui.buttons[up].enabled && !draft.ui.buttons[down].enabled, `${id} empty draft disables both steppers`);
    check((await call('controls.describe')).fields.find(control => control.id === id).value === null, `${id} empty draft discovery reads as null`);
    await noMutation('button.press', { id: up }, -32010);
    await noMutation('button.press', { id: down }, -32010);
    const restored = await field(id, start);
    check(restored.snapshot.controls[key] === start && restored.ui.fields[id].value === start && restored.ui.buttons[up].enabled && restored.ui.buttons[down].enabled, `${id} API set restores a valid focused draft`);
    await page.locator(`#${id}`).press('Tab');
  }
  await field('weight', 0);
  await field('pour-rate', 3);
  await press('pour');
  await page.locator('#weight').fill('100');
  check((await current()).snapshot.controls.grossWeight === 100, 'Typing a valid weight commits immediately');
  check(Math.abs((await step(2000)).snapshot.controls.grossWeight - 106) < 0.000001, 'Pouring advances a focused weight at 3g/s');
  await page.locator('#weight').press('Tab');
  check(Math.abs((await current()).snapshot.controls.grossWeight - 106) < 0.000001, 'Blurring a stale focused weight does not overwrite pouring progress');
  await press('pour');
  await field('weight', 0);
  const settings = await call('settings.get');
  check(settings.autoSleep && !settings.appTextEnabled, 'Settings API reads current firmware defaults');
  check(!(await first.call('state.get')).ui.playing, 'A single browser can be addressed without instanceId');
  const litPixels = await page.locator('#oled').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, 128, 64).data;
    return Array.from(data).filter((value, index) => index % 4 === 0 && value > 100).length;
  });
  check(await page.locator('#oled').isVisible() && litPixels > 0 && litPixels < 8192, 'Real browser OLED is visible and renders a nonblank frame');
  const examplePath = fileURLToPath(new URL('../tools/control-example.mjs', import.meta.url));
  const example = await promisify(execFile)(process.execPath, [examplePath, connectionFile, instanceId], { timeout: 15000, windowsHide: true });
  const exampleState = JSON.parse(example.stdout);
  check(Math.abs(exampleState.weight - 12.5) < 0.000001, `Control example returns12.5g: ${exampleState.weight}`);
  console.log(`HDS control example returned weight: ${exampleState.weight}`);

  await field('weight', 125.4);
  check((await press('tare')).snapshot.weight === 0, 'API tare uses the visible control');
  await field('pour-rate', 12);
  await press('pour');
  check(Math.abs((await step(2000)).snapshot.weight - 24) < 0.001, 'API pouring advances deterministically');
  await press('pour');
  check((await press('square')).snapshot.timerRunning, 'API physical Square starts timer');
  const timerAdvanced = (await step(1600)).snapshot.timerMs;
  check(Math.abs(timerAdvanced - 1600) < 0.001, `API clock advances timer by1600ms: ${timerAdvanced}`);
  check(!(await press('square')).snapshot.timerRunning, 'API Square stops timer');
  await step(700);
  check((await press('square')).snapshot.timerMs === 0, 'API Square resets stopped timer');

  await field('scene', 'main');
  check((await press('circle')).snapshot.menu.selected === 1, 'Circle navigates Main');
  check((await press('square')).snapshot.screen === 'scale', 'Square enters selected submenu');
  check((await call('button.down', { id: 'square' })).snapshot.held.square, 'Remote button down holds physical input');
  check((await step(899)).snapshot.screen === 'scale', '899ms is not a long hold');
  check((await step(1)).snapshot.screen === 'main', '900ms Square hold returns to Main');
  check((await call('button.up', { id: 'square' })).snapshot.menu.selected === 1, 'Hold release does not also select a row');
  await field('scene', 'display');
  await press('circle');
  await press('square');
  check((await call('settings.get')).screenFlipped, 'API menu actions change real persisted settings');
  await field('scene', 'info');
  await press('circle');
  check((await press('square')).snapshot.screen === 'status', 'Info page is reachable through the API');
  check((await press('circle')).snapshot.screen === 'status', 'Info page ignores Circle');
  check((await press('square')).snapshot.screen === 'info', 'Info page dismisses on Square release');

  check((await field('ble-enabled', false)).snapshot.icons.bleEnabled === false, 'BLE enabled field updates the simulator');
  await noMutation('field.set', { id: 'ble-connected', value: true });
  await field('ble-enabled', true);
  await field('ble-connected', true);
  await field('wifi-enabled', true);
  check((await field('wifi-connected', true)).snapshot.icons.wifiConnected, 'WiFi fields use the same UI path');
  check((await field('battery', 37)).snapshot.icons.batteryPercent === 37, 'Battery field updates the simulator');
  await field('usb-present', false);
  await noMutation('field.set', { id: 'charging', value: true });
  await field('usb-present', true);
  check((await field('charging', true)).snapshot.icons.charging, 'Charging field is available when USB is present');

  await field('scene', 'display');
  for (let index = 0; index < 3; index++) await press('circle');
  await press('square');
  await field('scene', 'weighing');
  await field('prompt', 'Carpano Antica Sweet Vermouth: 31g');
  check((await current()).snapshot.prompt.text === '', 'Editing prompt draft does not prematurely send it');
  check((await press('show-prompt')).snapshot.prompt.visible, 'Show publishes the validated prompt');
  await call('button.down', { id: 'circle' });
  check((await step(900)).snapshot.prompt.cancelled, 'Remote Circle hold cancels App Text');
  await call('button.up', { id: 'circle' });
  await press('clear-prompt');
  await field('ble-connected', false);
  await field('ble-connected', true);
  await field('prompt', '');
  await noMutation('button.press', { id: 'show-prompt' });
  await field('prompt', 'A'.repeat(128));
  check((await press('show-prompt')).snapshot.prompt.text.length === 128, 'Maximum ASCII prompt is accepted');

  for (const [method, params] of [
    ['field.set', { id: 'weight', value: 10000.1 }], ['field.set', { id: 'weight', value: '2' }],
    ['field.set', { id: 'weight', value: 0.15 }], ['field.set', { id: 'pour-rate', value: 1.5 }],
    ['field.set', { id: 'weight', value: 1, extra: true }], ['field.set', { id: 'pour-rate', value: -1 }],
    ['field.set', { id: 'battery', value: 1.5 }], ['field.set', { id: 'scene', value: 'unknown' }],
    ['field.set', { id: 'prompt', value: 'A'.repeat(129) }], ['field.set', { id: 'prompt', value: 'caf\u00e9' }],
    ['field.set', { id: '__proto__', value: true }], ['button.down', { id: 'tare' }],
    ['button.press', { id: 'unknown' }], ['button.press', { id: 'circle', extra: true }],
    ['clock.advance', { ms: -1 }], ['clock.advance', { ms: '100' }], ['clock.advance', { ms: 86400001 }],
    ['clock.pause', { extra: true }], ['state.get', { extra: true }], ['unknown.method', {}],
  ]) await noMutation(method, params);

  check((await press('view-full')).ui.view === 'full', 'Full view is controllable');
  check((await press('view-detail')).ui.view === 'detail', 'Detail view is controllable');
  check((await press('clean-view')).ui.clean, 'Clean view is controllable');
  check(!(await press('exit-clean')).ui.clean, 'Clean view can be exited through the API');
  const beforeStep = (await current()).snapshot.now;
  check((await press('step')).snapshot.now === beforeStep + 100, 'Step button advances exactly100ms');
  check((await press('play-pause')).ui.playing, 'Play button resumes clock');
  check(!(await call('clock.pause')).ui.playing, 'Clock pause is explicit');
  check((await call('clock.resume')).ui.playing, 'Clock resume is explicit');
  await call('clock.pause');
  check((await press('setup-boot')).snapshot.screen === 'boot', 'Setup boot is a GUI command');
  check((await step(1000)).snapshot.screen === 'setup', 'Setup message follows boot');
  check((await step(1000)).snapshot.screen === 'main', 'Setup boot enters Main');
  check((await press('restart')).snapshot.screen === 'boot', 'Normal restart is controllable');
  await step(1000);
  await field('scene', 'scale');
  for (let index = 0; index < 3; index++) await press('circle');
  await press('square');
  await press('circle');
  await press('square');
  await field('scene', 'weighing');
  await step(1001);
  await field('weight', 42.5);
  check((await press('double-tap')).snapshot.weight === 0, 'Enabled double surface tap is controllable');
  check((await press('triple-tap')).snapshot.timerRunning, 'Enabled triple surface tap is controllable');
  await noMutation('button.press', { id: 'double-tap' });

  const changed = first.notification('state.changed', params => params.instanceId === instanceId && params.state?.snapshot.controls.grossWeight === 333.3);
  await field('weight', 333.3);
  check((await changed).state.snapshot.controls.grossWeight === 333.3, 'Subscription publishes changed browser snapshots');
  const secondRegistered = first.notification('instances.changed', params => params.instances?.length === 2);
  await openPage();
  await secondRegistered;
  const instances = (await first.call('instances.list')).instances;
  const secondId = instances.find(instance => instance.instanceId !== instanceId).instanceId;
  check(secondId !== instanceId, 'Separate tabs register distinct instance IDs');
  await assert.rejects(first.call('state.get'), error => error.code === -32002);
  checks++;
  await call('clock.pause', {}, secondId);
  await press('reset-defaults', secondId);
  await call('clock.advance', { ms: 1000 }, secondId);
  await field('weight', 111.1);
  const secondChanged = first.notification('state.changed', params => params.instanceId === secondId && params.state?.snapshot.controls.grossWeight === 222.2);
  await field('weight', 222.2, secondId);
  await secondChanged;
  check((await current()).snapshot.controls.grossWeight === 111.1, 'Explicit routing does not mutate the other tab');
  check((await call('state.get', {}, secondId)).snapshot.controls.grossWeight === 222.2, 'Explicit routing selects the requested tab');
  await first.call('unsubscribe');
  const noChange = first.notification('state.changed', params => params.instanceId === secondId && params.state?.snapshot.controls.grossWeight === 223.2, 250);
  const noChangeCheck = assert.rejects(noChange, /Notification timed out/);
  await field('weight', 223.2, secondId);
  await noChangeCheck;
  checks++;

  const observer = await Client.connect(server.wsUrl, config.token);
  await observer.call('subscribe', { instanceId });
  await field('scene', 'main');
  check((await call('button.down', { id: 'circle' })).snapshot.held.circle, 'Controller owns its held button');
  await assert.rejects(observer.call('button.up', { instanceId, id: 'circle' }), error => error.code === -32011);
  check((await observer.call('state.get', { instanceId })).snapshot.held.circle, 'Another controller cannot release an owned button');
  const released = observer.notification('state.changed', params => params.instanceId === instanceId && !params.state?.snapshot.held.circle);
  await first.close();
  await released;
  const disconnected = await observer.call('state.get', { instanceId });
  check(!disconnected.snapshot.held.circle && disconnected.snapshot.menu.selected === 0, 'Disconnect cancels holds without release actions');
  check((await observer.call('clock.advance', { instanceId, ms: 1200 })).snapshot.menu.selected === 0, 'Disconnected holds cannot fire later');
  check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  console.log(`HDS simulator WebSocket API browser checks passed: ${checks}`);
} finally {
  if (browser) await browser.close();
  await Promise.allSettled([...clients].map(client => client.close()));
  if (server) await server.close();
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('hds-simulator-api-'));
  await fs.rm(temporary, { recursive: true, force: true });
}
