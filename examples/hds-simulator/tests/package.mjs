import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const bundle = path.resolve(process.argv[2] || '');
assert(process.argv[2], 'Pass a Windows bundle folder');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const execute = promisify(execFile);
const runtime = path.join(bundle, 'runtime/node.exe');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hds-package-smoke-'));
const connectionFile = path.join(temporary, 'connection.json');
const pending = new Map();
let child, browser, socket;
let sequence = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`API timed out: ${method}`)); }, 8000);
  pending.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
});

try {
  assert.equal((await execute(runtime, ['--version'], { windowsHide: true })).stdout.trim(), 'v22.23.3');
  const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'package-manifest.json'), 'utf8'));
  for (const entry of manifest.files) {
    const resolved = path.resolve(bundle, entry.path);
    assert(resolved.startsWith(bundle + path.sep), `Unsafe manifest path: ${entry.path}`);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(resolved)) digest.update(chunk);
    assert.equal(digest.digest('hex'), entry.sha256, entry.path);
  }
  child = spawn(runtime, [path.join(bundle, 'launch.mjs'), '--port', '0', '--no-open', '--connection-file', connectionFile],
    { cwd: temporary, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const errors = [];
  child.stderr.on('data', chunk => errors.push(chunk.toString()));
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Launcher timed out: ${errors.join('')}`)), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Launcher exited: ${code} ${errors.join('')}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/HDS Simulator: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const config = await (await fetch(new URL('/api/config', url))).json();
  assert.equal(JSON.parse(await fs.readFile(connectionFile, 'utf8')).token, config.token);
  socket = new WebSocket(config.wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('API connection failed')), { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  await call('auth', { token: config.token, role: 'controller' });
  await call('subscribe');
  const registered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bundled browser did not register')), 10000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'instances.changed' && message.params.instances.length === 1) {
        clearTimeout(timer);
        resolve(message.params.instances[0].instanceId);
      }
    });
  });
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const instanceId = await registered;
  const control = (method, params = {}) => call(method, { ...params, instanceId });
  await control('clock.pause');
  await control('button.press', { id: 'reset-defaults' });
  assert.equal((await control('clock.advance', { ms: 1000 })).snapshot.screen, 'weighing');
  await control('field.set', { id: 'weight', value: 12.5 });
  assert.equal((await control('state.get')).snapshot.weight, 12.5);
  const lit = await page.locator('#oled').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, 128, 64).data;
    return Array.from(data).filter((value, index) => index % 4 === 0 && value > 100).length;
  });
  assert(lit > 0 && lit < 8192 && await page.locator('#oled').isVisible());
  assert(await page.locator('.scale-photo').isVisible());
  assert(requests.every(request => request.startsWith('data:') || new URL(request).origin === new URL(url).origin));
  assert.equal((await fetch(new URL('/sources/README.md', url))).status, 404);
  const example = await execute(runtime, [path.join(bundle, 'app/tools/control-example.mjs'), connectionFile, instanceId], { timeout: 15000, windowsHide: true });
  assert(Math.abs(JSON.parse(example.stdout).weight - 12.5) < 0.000001);
  assert.deepEqual(errors, []);
  console.log(`Portable Windows bundle passed: ${manifest.files.length} file hashes, bundled Node, launcher, photo/WASM OLED, authenticated API, 12.5g example, local-only requests`);
} finally {
  if (browser) await browser.close();
  socket?.close();
  for (const item of pending.values()) clearTimeout(item.timer);
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert(path.basename(temporary).startsWith('hds-package-smoke-'));
  await fs.rm(temporary, { recursive: true, force: true });
}
