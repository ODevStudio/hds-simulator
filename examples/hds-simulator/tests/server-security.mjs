import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { WebSocket } from 'ws';
import { startServer } from '../server.mjs';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));

function httpRequest(server, pathname = '/', headers = {}, method = 'GET') {
  const url = new URL(server.url);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, path: pathname, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function client(server, params = { role: 'controller' }) {
  const socket = new WebSocket(server.wsUrl);
  const messages = [];
  const waiters = [];
  let nextId = 1;
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    const index = waiters.findIndex(waiter => waiter.predicate(message));
    if (index < 0) messages.push(message);
    else { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  function next(predicate, timeout = 7000) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('WebSocket message timed out')); }, timeout) };
      waiters.push(waiter);
    });
  }
  const send = message => socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  function request(method, parameters = {}) {
    const id = nextId++;
    send({ jsonrpc: '2.0', id, method, params: parameters });
    return next(message => message.id === id);
  }
  const auth = await request('auth', { token: server.token, ...params });
  return { socket, messages, next, send, request, auth };
}

test('localhost relay security and routing', async context => {
  const temporaryRoot = path.resolve(appDirectory, '../../.pio.nosync');
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, 'hds-server-test-'));
  const root = path.join(temporary, 'app');
  await mkdir(root);
  await mkdir(path.join(root, '.hidden'));
  await writeFile(path.join(root, '.hidden', 'secret'), 'hidden');
  await writeFile(path.join(root, 'index.html'), '<meta name="hds-control-api" content=""><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'">');
  await writeFile(path.join(root, 'test.mjs'), 'export const value = 1;');
  await writeFile(path.join(root, 'test.wasm'), Buffer.from([0, 97, 115, 109]));
  await writeFile(path.join(temporary, 'secret'), 'private');
  const server = await startServer({ port: 0, appRoot: root, connectionFile: path.join(temporary, 'private', 'connection.json') });
  context.after(async () => { await server.close(); await rm(temporary, { recursive: true, force: true }); });
  const controller = await client(server);
  const browserId = randomUUID();
  const browser = await client(server, { role: 'browser', instanceId: browserId, label: 'Test scale' });

  await context.test('private config, exact CSP, MIME, no-store and no CORS', async () => {
    assert.equal(controller.auth.result.role, 'controller');
    assert.equal(browser.auth.result.instanceId, browserId);
    const config = await httpRequest(server, '/api/config');
    assert.deepEqual(JSON.parse(config.body), { protocolVersion: 1, wsUrl: server.wsUrl, token: server.token });
    const privateConfig = JSON.parse(await readFile(server.connectionFile, 'utf8'));
    assert.equal(privateConfig.token, server.token);
    assert.equal((await realpath(path.dirname(server.connectionFile))).startsWith(await realpath(root)), false);
    const html = await httpRequest(server);
    assert.match(html.body, /name="hds-control-api" content="\/api\/config"/);
    assert.match(html.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(html.body, new RegExp(`ws://127\\.0\\.0\\.1:${new URL(server.url).port}`));
    assert.equal(html.headers['cache-control'], 'no-store');
    assert.equal(html.headers['access-control-allow-origin'], undefined);
    assert.equal((await httpRequest(server, '/test.mjs')).headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal((await httpRequest(server, '/test.wasm')).headers['content-type'], 'application/wasm');
    assert.equal((await httpRequest(server, '/', {}, 'POST')).status, 405);
    assert.equal((await httpRequest(server, '/', {}, 'HEAD')).body, '');
  });

  await context.test('Host, Origin, traversal, controls and hidden files are denied', async () => {
    for (const headers of [{ Host: 'evil.example' }, { Origin: 'https://evil.example' }, { Origin: 'null' }, { Host: `localhost:${Number(new URL(server.url).port) + 1}` }]) {
      assert.equal((await httpRequest(server, '/api/config', headers)).status, 403);
    }
    for (const pathname of ['/../secret', '/%2e%2e/secret', '/a/%2e%2e/secret', '/.hidden/secret', '/%2ehidden/secret', '/foo%5c..%5csecret', '/test.mjs:secret', '/test.mjs%00', '//secret', '/%ZZ', '/CON', '/nul.txt', '/COM1']) {
      assert.equal((await httpRequest(server, pathname)).status, 403, pathname);
    }
    assert.equal((await httpRequest(server, '/missing')).status, 404);
    const duplicateHost = await new Promise((resolve, reject) => {
      const url = new URL(server.url);
      const socket = net.connect(Number(url.port), '127.0.0.1');
      let reply = '';
      socket.on('connect', () => socket.write(`GET /api/config HTTP/1.1\r\nHost: 127.0.0.1:${url.port}\r\nHost: localhost:${url.port}\r\nConnection: close\r\n\r\n`));
      socket.on('data', data => { reply += data; });
      socket.on('end', () => resolve(reply));
      socket.on('error', reject);
    });
    assert.match(duplicateHost, /^HTTP\/1\.1 (400|403)/);
  });

  await context.test('symlink escapes and hidden resolved targets are denied', async () => {
    try {
      await symlink(path.join(temporary, 'secret'), path.join(root, 'escape'));
      await symlink(path.join(root, '.hidden', 'secret'), path.join(root, 'hidden-link'));
    } catch (error) {
      if (['EPERM', 'EACCES'].includes(error.code)) return context.diagnostic('File symlink creation unavailable on this Windows account');
      throw error;
    }
    assert.equal((await httpRequest(server, '/escape')).status, 403);
    assert.equal((await httpRequest(server, '/hidden-link')).status, 403);
  });

  await context.test('connection files cannot be inside the served root', async () => {
    await assert.rejects(startServer({ port: 0, appRoot: root, connectionFile: path.join(root, 'connection.json') }), /outside the served app/);
    const alias = path.join(temporary, 'app-alias');
    try { await symlink(root, alias, 'junction'); }
    catch (error) {
      if (['EPERM', 'EACCES'].includes(error.code)) return context.diagnostic('Directory symlink creation unavailable on this Windows account');
      throw error;
    }
    await assert.rejects(startServer({ port: 0, appRoot: root, connectionFile: path.join(alias, 'connection.json') }), /resolves inside the served app/);
  });

  await context.test('auth rejects invalid tokens, IDs and duplicate browsers', async () => {
    const bad = await client(server, { role: 'controller', token: '0'.repeat(64) });
    assert.equal(bad.auth.error.code, -32000);
    bad.socket.terminate();
    const duplicate = await client(server, { role: 'browser', instanceId: browserId });
    assert.equal(duplicate.auth.error.code, -32003);
    duplicate.socket.terminate();
    controller.send('{');
    assert.equal((await controller.next(message => message.id === null)).error.code, -32700);
    controller.send({ jsonrpc: '2.0', id: null, method: 'state.get' });
    assert.equal((await controller.next(message => message.id === null)).error.code, -32600);
    controller.send({ jsonrpc: '2.0', id: '', method: 'instances.list' });
    assert.equal((await controller.next(message => message.id === '')).result.instances.length, 1);
    assert.equal((await controller.request('shell.execute')).error.code, -32601);
    assert.equal((await controller.request('state.get', { instanceId: randomUUID() })).error.code, -32001);
  });

  await context.test('deep JSON and invalid routed schemas cannot crash the relay', async () => {
    controller.send(`{"jsonrpc":"2.0","id":91,"method":"field.set","params":{"id":"weight","value":${'['.repeat(9000)}0${']'.repeat(9000)}}}`);
    assert.equal((await controller.next(message => message.id === null)).error.code, -32600);
    assert.equal((await controller.request('field.set', { id: 'weight', value: {} })).error.code, -32602);
    assert.equal((await controller.request('clock.advance', { ms: -1 })).error.code, -32602);
    assert.equal((await controller.request('state.get', [])).error.code, -32602);
    browser.send(`{"jsonrpc":"2.0","method":"state.publish","params":{"state":{"snapshot":{"deep":${'['.repeat(9000)}0${']'.repeat(9000)}},"ui":{}}}}`);
    assert.equal((await browser.next(message => message.id === null)).error.code, -32600);
    assert.equal((await controller.request('instances.list')).result.instances.length, 1);
  });

  await context.test('subscription registry is bounded', async () => {
    const subscriber = await client(server);
    try {
      for (let index = 0; index < 128; index++) assert.equal((await subscriber.request('subscribe', { instanceId: randomUUID() })).error, undefined);
      assert.equal((await subscriber.request('subscribe', { instanceId: randomUUID() })).error.code, -32006);
      assert.equal((await subscriber.request('unsubscribe')).error, undefined);
      assert.equal((await subscriber.request('subscribe', { instanceId: randomUUID() })).error, undefined);
    } finally { subscriber.socket.terminate(); }
  });

  await context.test('WebSocket upgrades reject foreign origins and hosts', async () => {
    for (const headers of [{ Origin: 'https://evil.example' }, { Host: 'evil.example' }]) {
      const status = await new Promise((resolve, reject) => {
        const socket = new WebSocket(server.wsUrl, { headers });
        socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); });
        socket.once('open', () => { socket.terminate(); reject(new Error('Unexpected WebSocket upgrade')); });
        socket.once('error', reject);
      });
      assert.equal(status, 403);
    }
  });

  await context.test('unauthenticated sockets expire and oversized frames close', async () => {
    const socket = new WebSocket(server.wsUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await new Promise(resolve => socket.once('close', resolve));
    const oversized = await client(server);
    const closed = new Promise(resolve => oversized.socket.once('close', resolve));
    oversized.send('x'.repeat(32769));
    await closed;
  });

  await context.test('live WebSocket connections are bounded', async () => {
    const limited = await startServer({ port: 0, appRoot: root, connectionFile: path.join(temporary, 'limited', 'connection.json') });
    const clients = [];
    try {
      for (let index = 0; index < 64; index++) clients.push(await client(limited));
      const status = await new Promise((resolve, reject) => {
        const socket = new WebSocket(limited.wsUrl);
        socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); });
        socket.once('open', () => { socket.terminate(); reject(new Error('Connection limit was not enforced')); });
        socket.once('error', reject);
      });
      assert.equal(status, 403);
    } finally {
      for (const current of clients) current.socket.terminate();
      await limited.close();
    }
  });

  await context.test('routing remaps IDs, strips target and overrides controller ownership', async () => {
    const response = controller.request('state.get', { instanceId: browserId, controllerId: 'forged' });
    const routed = await browser.next(message => message.method === 'state.get');
    assert.notEqual(routed.params.controllerId, 'forged');
    assert.equal(routed.params.instanceId, undefined);
    assert.equal(typeof routed.id, 'string');
    browser.send({ jsonrpc: '2.0', id: routed.id, result: { value: 42 } });
    assert.deepEqual((await response).result, { value: 42 });
    const secondBrowser = await client(server, { role: 'browser' });
    assert.equal((await controller.request('state.get')).error.code, -32002);
    const pending = controller.request('settings.get', { instanceId: browserId });
    const request = await browser.next(message => message.method === 'settings.get');
    secondBrowser.send({ jsonrpc: '2.0', id: request.id, result: 'forged' });
    browser.send({ jsonrpc: '2.0', id: request.id, result: 'real' });
    assert.equal((await pending).result, 'real');
    secondBrowser.socket.terminate();
  });

  await context.test('pending IDs cannot collide with local or routed methods', async () => {
    controller.send({ jsonrpc: '2.0', id: 'pending', method: 'state.get', params: { instanceId: browserId } });
    const routed = await browser.next(message => message.method === 'state.get');
    controller.send({ jsonrpc: '2.0', id: 'pending', method: 'instances.list' });
    assert.equal((await controller.next(message => message.id === 'pending')).error.code, -32600);
    browser.send({ jsonrpc: '2.0', id: routed.id, result: true });
    assert.equal((await controller.next(message => message.id === 'pending')).result, true);
  });

  await context.test('subscriptions cache state and support all minus one', async () => {
    const state = { snapshot: { clock: 1 }, ui: { playing: false } };
    browser.send({ jsonrpc: '2.0', method: 'state.publish', params: { state } });
    await controller.request('subscribe');
    assert.deepEqual((await controller.next(message => message.method === 'state.changed')).params, { instanceId: browserId, state });
    await controller.request('unsubscribe', { instanceId: browserId });
    browser.send({ jsonrpc: '2.0', method: 'state.publish', params: { state: { ...state, ui: { playing: true } } } });
    const roundTrip = controller.request('state.get', { instanceId: browserId });
    const request = await browser.next(message => message.method === 'state.get');
    browser.send({ jsonrpc: '2.0', id: request.id, result: true });
    await roundTrip;
    assert.equal(controller.messages.some(message => message.method === 'state.changed'), false);
    await controller.request('subscribe', { instanceId: browserId });
    assert.equal((await controller.next(message => message.method === 'state.changed')).params.state.ui.playing, true);
  });

  await context.test('controller disconnect cancels only its own held buttons', async () => {
    const holder = await client(server);
    const down = holder.request('button.down', { id: 'circle', instanceId: browserId });
    const request = await browser.next(message => message.method === 'button.down');
    browser.send({ jsonrpc: '2.0', id: request.id, result: true });
    await down;
    const cancelled = browser.next(message => message.method === 'controls.cancel');
    holder.socket.terminate();
    assert.deepEqual((await cancelled).params, { controllerId: request.params.controllerId });
  });

  await context.test('requests time out and closed targets reject outstanding work', async () => {
    const down = controller.request('button.down', { id: 'circle', instanceId: browserId });
    const routedDown = await browser.next(message => message.method === 'button.down');
    assert.equal((await down).error.code, -32004);
    assert.deepEqual((await browser.next(message => message.method === 'controls.cancel')).params, { controllerId: routedDown.params.controllerId });
    assert.equal((await controller.request('instances.list')).result.instances.length, 1);
    const response = controller.request('settings.get', { instanceId: browserId });
    await browser.next(message => message.method === 'settings.get');
    browser.socket.terminate();
    assert.equal((await response).error.code, -32005);
  });

  await context.test('CLI announces URL and connection file without disclosing token', async () => {
    const filename = path.join(temporary, 'cli', 'connection.json');
    const child = spawn(process.execPath, ['server.mjs', '--port', '0', '--connection-file', filename], { cwd: appDirectory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = await new Promise((resolve, reject) => {
      let data = '';
      child.stdout.on('data', chunk => { data += chunk; if (data.includes('Connection file:')) resolve(data); });
      child.stderr.on('data', chunk => reject(new Error(chunk.toString())));
      child.once('error', reject);
      child.once('exit', code => { if (!data.includes('Connection file:')) reject(new Error(`CLI exited: ${code}`)); });
    });
    const connection = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(output.includes(connection.token), false);
    assert.match(output, /Simulator: http:\/\/127\.0\.0\.1:\d+\//);
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  });
});
