import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { connectControlApi } from '../src/api-bridge.mjs';

function fixture(t) {
  const sockets = [];
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 2; }
    closed() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    authenticate() {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', id: 0, result: { role: 'browser' } }) }));
    }
  }
  const document = Object.assign(new EventTarget(), { querySelector: () => ({ content: '/api/config' }) });
  const window = new EventTarget();
  const globals = { document, window, WebSocket: FakeSocket, location: { port: '18916' },
    fetch: async () => ({ ok: true, json: async () => ({ protocolVersion: 1, wsUrl: 'ws://127.0.0.1:18916/api/ws', token: 'test' }) }) };
  const descriptors = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  t.after(() => {
    window.dispatchEvent(new Event('pagehide'));
    for (const name of Object.keys(globals)) {
      if (descriptors[name]) Object.defineProperty(globalThis, name, descriptors[name]);
      else delete globalThis[name];
    }
  });
  let cancelled = 0;
  const publish = connectControlApi({ getState: () => ({ snapshot: {}, ui: {} }), cancelRemote: () => { cancelled++; } });
  const restore = () => {
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
  };
  return { sockets, window, publish, restore, cancelled: () => cancelled };
}

test('a delayed old close cannot cancel a restored page connection', async t => {
  const controls = fixture(t);
  await nextTurn();
  const old = controls.sockets[0];
  old.authenticate();
  controls.window.dispatchEvent(new Event('pagehide'));
  controls.restore();
  await nextTurn();
  assert.equal(controls.sockets.length, 2);
  const current = controls.sockets[1];
  current.authenticate();
  const count = controls.cancelled();
  old.closed();
  controls.publish();
  assert.equal(controls.cancelled(), count);
  assert.equal(current.sent.at(-1).method, 'state.publish');
});

test('page suspension cancels queued reconnects instead of opening duplicate sockets', async t => {
  const controls = fixture(t);
  await nextTurn();
  controls.sockets[0].authenticate();
  controls.sockets[0].closed();
  controls.window.dispatchEvent(new Event('pagehide'));
  controls.restore();
  await nextTurn();
  controls.sockets[1].authenticate();
  await delay(300);
  assert.equal(controls.sockets.length, 2);
});
