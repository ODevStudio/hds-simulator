export function connectControlApi(controls) {
  const configPath = document.querySelector('meta[name="hds-control-api"]')?.content;
  if (!configPath) return () => {};
  const instanceId = crypto.randomUUID();
  let socket;
  let authenticated = false;
  let stopped = false;
  let retryMs = 250;
  let lastState = '';
  let reconnectTimer;
  let generation = 0;

  const transmit = message => {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 1048576) {
      socket.close(1008, 'Slow connection');
      return false;
    }
    socket.send(JSON.stringify({ jsonrpc: '2.0', ...message }));
    return true;
  };
  const publish = () => {
    if (!authenticated) return;
    const state = controls.getState();
    const serialized = JSON.stringify(state);
    if (serialized === lastState) return;
    if (transmit({ method: 'state.publish', params: { state } })) lastState = serialized;
  };
  const receive = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { socket.close(1008, 'Invalid response'); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') return;
    if (message.id === 0 && !message.method) {
      if (message.error) { socket.close(1008, 'Authentication failed'); return; }
      authenticated = true;
      retryMs = 250;
      lastState = '';
      publish();
      return;
    }
    if (!authenticated) return;
    if (message.method === 'controls.cancel') {
      controls.cancel(message.params?.controllerId);
      publish();
      return;
    }
    if (!Object.hasOwn(message, 'id')) return;
    try {
      const result = controls.execute(message.method, message.params);
      transmit({ id: message.id, result });
    } catch (error) {
      transmit({ id: message.id, error: { code: error.code || -32603, message: error.message || 'Control failed' } });
    }
    publish();
  };
  const reconnect = () => {
    authenticated = false;
    socket = null;
    controls.cancelRemote();
    if (stopped) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(5000, retryMs * 2);
  };
  async function connect() {
    if (stopped || socket && socket.readyState <= WebSocket.OPEN) return;
    clearTimeout(reconnectTimer);
    const attempt = ++generation;
    try {
      const response = await fetch(configPath, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('Control server unavailable');
      const config = await response.json();
      const endpoint = new URL(config.wsUrl);
      if (config.protocolVersion !== 1 || endpoint.protocol !== 'ws:' ||
        !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.port !== location.port ||
        endpoint.pathname !== '/api/ws' || typeof config.token !== 'string') throw new Error('Invalid control configuration');
      if (stopped || attempt !== generation) return;
      const current = new WebSocket(endpoint);
      socket = current;
      const isCurrent = () => !stopped && attempt === generation && socket === current;
      current.addEventListener('open', () => {
        if (isCurrent()) transmit({ id: 0, method: 'auth', params: { token: config.token, role: 'browser', instanceId, label: document.title } });
      });
      current.addEventListener('message', event => { if (isCurrent()) receive(event); });
      current.addEventListener('close', () => { if (isCurrent()) reconnect(); });
      current.addEventListener('error', () => {});
    } catch {
      if (!stopped && attempt === generation) reconnect();
    }
  }
  for (const type of ['input', 'change', 'click', 'keydown']) document.addEventListener(type, () => queueMicrotask(publish));
  window.addEventListener('pagehide', () => {
    authenticated = false;
    stopped = true;
    generation++;
    clearTimeout(reconnectTimer);
    const current = socket;
    socket = null;
    controls.cancelRemote();
    current?.close();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    stopped = false;
    connect();
  });
  connect();
  return publish;
}
