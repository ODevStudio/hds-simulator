import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay.mjs';
import { createToken, requestAllowed, requestPath, staticPath, writeConnectionFile } from './security.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

export async function startServer({ port = 18916, appRoot = defaultRoot, connectionFile = path.resolve(defaultRoot, '../../.pio.nosync/hds-simulator-control/connection.json') } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0-65535');
  const root = await realpath(appRoot);
  const token = createToken();
  let actualPort;
  const getCsp = () => `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:${actualPort} ws://localhost:${actualPort}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  const getConfig = () => ({ protocolVersion: 1, wsUrl: `ws://127.0.0.1:${actualPort}/api/ws`, token });

  async function handle(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', getCsp());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!requestAllowed(request, actualPort)) { response.writeHead(403).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    let relative;
    try { relative = requestPath(request.url); }
    catch { response.writeHead(403).end(); return; }
    if (relative === 'api/config') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(getConfig()));
      return;
    }
    if (relative.startsWith('api/')) { response.writeHead(404).end(); return; }
    try {
      const filename = await staticPath(root, relative);
      if (!(await stat(filename)).isFile()) { response.writeHead(404).end(); return; }
      const extension = path.extname(filename).toLowerCase();
      response.setHeader('Content-Type', contentTypes[extension] ?? 'application/octet-stream');
      if (request.method === 'HEAD') { response.end(); return; }
      const contents = await readFile(filename);
      if (extension === '.html') {
        const html = contents.toString('utf8').replace('<meta name="hds-control-api" content="">', '<meta name="hds-control-api" content="/api/config">')
          .replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, `$1${getCsp().replace("; frame-ancestors 'none'", '')}$2`);
        response.end(html);
      } else response.end(contents);
    } catch (error) { response.writeHead(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 403).end(); }
  }

  const server = http.createServer((request, response) => { handle(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); }); });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const relay = createRelay(server, () => actualPort, token);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  actualPort = server.address().port;
  const url = `http://127.0.0.1:${actualPort}/`;
  let privateFile;
  try { privateFile = await writeConnectionFile(connectionFile, root, { ...getConfig(), url }); }
  catch (error) { await relay.close(); await new Promise(resolve => server.close(resolve)); throw error; }
  let closing;
  return { url, wsUrl: getConfig().wsUrl, token, connectionFile: privateFile,
    close() {
      closing ??= (async () => { await relay.close(); server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); })();
      return closing;
    },
  };
}
