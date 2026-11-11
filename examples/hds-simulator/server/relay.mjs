import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { isBoundedJson, isId, isInstanceId, isObject, requestAllowed, tokenMatches, validRoutedParams } from './security.mjs';

const routedMethods = new Set(['state.get', 'settings.get', 'controls.describe', 'field.set', 'button.press', 'button.down', 'button.up', 'clock.pause', 'clock.resume', 'clock.advance']);
const rpcError = (code, message) => ({ code, message });

export function createRelay(server, getPort, token) {
  const sockets = new Set();
  const browsers = new Map();
  const pending = new Map();
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });

  function send(client, message) {
    if (client.socket.readyState !== WebSocket.OPEN) return false;
    let encoded;
    try { encoded = JSON.stringify(message); }
    catch { client.socket.terminate(); return false; }
    if (client.socket.bufferedAmount + Buffer.byteLength(encoded) > 1048576) {
      client.socket.terminate();
      return false;
    }
    client.socket.send(encoded, error => { if (error) client.socket.terminate(); });
    return true;
  }

  const respond = (client, id, result) => send(client, { jsonrpc: '2.0', id, result });
  const reject = (client, id, code, message) => send(client, { jsonrpc: '2.0', id, error: rpcError(code, message) });
  const notify = (client, method, params) => send(client, { jsonrpc: '2.0', method, params });
  const instances = () => ({ instances: Array.from(browsers.values(), ({ instanceId, label, connectedAt }) => ({ instanceId, label, connectedAt })) });
  const watches = (client, id) => client.all ? !client.excluded.has(id) : client.subscriptions.has(id);

  function publishInstances() {
    for (const client of sockets) if (client.role === 'controller') notify(client, 'instances.changed', instances());
  }

  function finish(internalId, result, error) {
    const request = pending.get(internalId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(internalId);
    request.controller.requests.delete(request.id);
    if (error && request.method === 'button.down') {
      request.controller.held.delete(request.browser.instanceId);
      notify(request.browser, 'controls.cancel', { controllerId: request.controller.controllerId });
    }
    if (!error && request.method === 'button.up') {
      const buttons = request.controller.held.get(request.browser.instanceId);
      buttons?.delete(request.button);
      if (buttons?.size === 0) request.controller.held.delete(request.browser.instanceId);
    }
    if (error) reject(request.controller, request.id, error.code, error.message);
    else respond(request.controller, request.id, result);
  }

  function disconnect(client) {
    clearTimeout(client.authTimer);
    sockets.delete(client);
    if (client.role === 'browser' && browsers.get(client.instanceId) === client) {
      browsers.delete(client.instanceId);
      for (const [id, request] of pending) if (request.browser === client) finish(id, undefined, rpcError(-32005, 'Target closed'));
      for (const controller of sockets) controller.held.delete(client.instanceId);
      publishInstances();
    }
    if (client.role === 'controller') {
      for (const instanceId of client.held.keys()) {
        const browser = browsers.get(instanceId);
        if (browser) notify(browser, 'controls.cancel', { controllerId: client.controllerId });
      }
      for (const [id, request] of pending) if (request.controller === client) {
        clearTimeout(request.timer);
        pending.delete(id);
      }
    }
  }

  function authenticate(client, message) {
    const { id, method, params } = message;
    if (method !== 'auth' || !isObject(params) || !tokenMatches(params.token, token)) {
      reject(client, id, -32000, 'Authentication required');
      client.socket.close(1008, 'Authentication required');
      return;
    }
    const validLabel = params.label === undefined || typeof params.label === 'string' && params.label.length <= 80 && !/[\x00-\x1f\x7f]/.test(params.label);
    if (!['browser', 'controller'].includes(params.role) || !validLabel || params.instanceId !== undefined && !isInstanceId(params.instanceId)) {
      reject(client, id, -32602, 'Invalid authentication parameters');
      return;
    }
    const instanceId = params.role === 'browser' ? params.instanceId ?? randomUUID() : undefined;
    if (instanceId && browsers.has(instanceId)) {
      reject(client, id, -32003, 'Duplicate browser instance');
      return;
    }
    clearTimeout(client.authTimer);
    Object.assign(client, { role: params.role, instanceId, label: params.label ?? 'HDS simulator', connectedAt: new Date().toISOString() });
    if (instanceId) browsers.set(instanceId, client);
    respond(client, id, { protocolVersion: 1, role: client.role, ...(instanceId ? { instanceId } : {}) });
    if (instanceId) publishInstances();
  }

  function subscribe(client, message) {
    const params = message.params ?? {};
    if (Object.keys(params).some(key => key !== 'instanceId') || params.instanceId !== undefined && !isInstanceId(params.instanceId)) {
      reject(client, message.id, -32602, 'Invalid subscription parameters');
      return;
    }
    const instanceId = params.instanceId;
    if (instanceId !== undefined && client.subscriptions.size + client.excluded.size >= 128 &&
        !client.subscriptions.has(instanceId) && !client.excluded.has(instanceId)) {
      reject(client, message.id, -32006, 'Too many subscriptions');
      return;
    }
    if (message.method === 'subscribe') {
      if (instanceId === undefined) { client.all = true; client.excluded.clear(); }
      else { client.subscriptions.add(instanceId); client.excluded.delete(instanceId); }
    } else if (instanceId === undefined) {
      client.all = false;
      client.subscriptions.clear();
      client.excluded.clear();
    } else {
      client.subscriptions.delete(instanceId);
      if (client.all) client.excluded.add(instanceId);
    }
    respond(client, message.id, { subscribed: message.method === 'subscribe' });
    if (message.method === 'subscribe') for (const browser of browsers.values()) {
      if (browser.state !== undefined && watches(client, browser.instanceId) && (instanceId === undefined || instanceId === browser.instanceId)) {
        notify(client, 'state.changed', { instanceId: browser.instanceId, state: browser.state });
      }
    }
  }

  function route(client, message) {
    if (client.requests.size >= 128 || pending.size >= 512) return reject(client, message.id, -32006, 'Too many pending requests');
    const params = message.params ?? {};
    if (params.instanceId !== undefined && !isInstanceId(params.instanceId)) return reject(client, message.id, -32602, 'Invalid instance ID');
    if (!validRoutedParams(message.method, params)) return reject(client, message.id, -32602, 'Invalid method parameters');
    const browser = params.instanceId === undefined ? browsers.size === 1 ? browsers.values().next().value : undefined : browsers.get(params.instanceId);
    if (!browser) return reject(client, message.id, params.instanceId === undefined && browsers.size > 1 ? -32002 : -32001, params.instanceId === undefined && browsers.size > 1 ? 'Ambiguous target' : 'Target not found');
    const { instanceId, ...forwarded } = params;
    const internalId = randomUUID();
    const timer = setTimeout(() => finish(internalId, undefined, rpcError(-32004, 'Target timed out')), 5000);
    pending.set(internalId, { controller: client, browser, id: message.id, method: message.method, button: params.id, timer });
    client.requests.add(message.id);
    if (message.method === 'button.down' && ['circle', 'square'].includes(params.id)) {
      if (!client.held.has(browser.instanceId)) client.held.set(browser.instanceId, new Set());
      client.held.get(browser.instanceId).add(params.id);
    }
    if (!send(browser, { jsonrpc: '2.0', id: internalId, method: message.method, params: { ...forwarded, controllerId: client.controllerId } })) finish(internalId, undefined, rpcError(-32005, 'Target closed'));
  }

  function browserMessage(client, message) {
    if (message.method === 'state.publish' && !Object.hasOwn(message, 'id') && isObject(message.params) && isObject(message.params.state) && isObject(message.params.state.snapshot) && isObject(message.params.state.ui)) {
      client.state = message.params.state;
      for (const controller of sockets) if (controller.role === 'controller' && watches(controller, client.instanceId)) {
        notify(controller, 'state.changed', { instanceId: client.instanceId, state: client.state });
      }
      return;
    }
    const request = pending.get(message.id);
    if (!request || request.browser !== client || Object.hasOwn(message, 'method')) return;
    const hasResult = Object.hasOwn(message, 'result');
    const validError = isObject(message.error) && Number.isSafeInteger(message.error.code) && typeof message.error.message === 'string';
    if (hasResult !== validError && (hasResult || validError)) finish(message.id, message.result, validError ? message.error : undefined);
  }

  function receive(client, data, binary) {
    let message;
    try { message = JSON.parse(data.toString()); }
    catch { reject(client, null, -32700, 'Parse error'); return; }
    if (binary || !isObject(message) || message.jsonrpc !== '2.0' || !isBoundedJson(message)) return reject(client, null, -32600, 'Invalid request');
    if (client.role === 'browser') return browserMessage(client, message);
    if (!isId(message.id) || typeof message.method !== 'string') return reject(client, null, -32600, 'Invalid request');
    if (message.params !== undefined && !isObject(message.params)) return reject(client, message.id, -32602, 'Invalid parameters');
    if (!client.role) return authenticate(client, message);
    if (client.requests.has(message.id)) return reject(client, message.id, -32600, 'Request ID already pending');
    if (message.method === 'instances.list') return respond(client, message.id, instances());
    if (['subscribe', 'unsubscribe'].includes(message.method)) return subscribe(client, message);
    if (routedMethods.has(message.method)) return route(client, message);
    reject(client, message.id, -32601, 'Method not found');
  }

  websocketServer.on('connection', socket => {
    const client = { socket, controllerId: randomUUID(), requests: new Set(), held: new Map(), subscriptions: new Set(), excluded: new Set(), all: false };
    client.authTimer = setTimeout(() => socket.terminate(), 3000);
    sockets.add(client);
    socket.on('message', (data, binary) => {
      try { receive(client, data, binary); }
      catch { socket.terminate(); }
    });
    socket.on('close', () => disconnect(client));
    socket.on('error', () => socket.terminate());
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/api/ws' || !requestAllowed(request, getPort()) || sockets.size >= 64) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, websocket => websocketServer.emit('connection', websocket, request));
  });
  return {
    async close() {
      for (const client of Array.from(sockets)) { disconnect(client); client.socket.terminate(); }
      await new Promise(resolve => websocketServer.close(resolve));
    },
  };
}
