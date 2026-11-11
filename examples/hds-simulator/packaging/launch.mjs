import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from './app/server.mjs';

function argumentsForLaunch(args) {
  return args.reduce((options, value, index) => {
    if (index > 0 && ['--port', '--connection-file'].includes(args[index - 1])) return options;
    if (value === '--no-open') return { ...options, open: false };
    if (value === '--port') {
      const port = args[index + 1];
      if (!/^\d{1,5}$/.test(port || '') || Number(port) > 65535) throw new Error('Port must be 0-65535');
      return { ...options, port: Number(port) };
    }
    if (value === '--connection-file') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing connection-file path');
      return { ...options, connectionFile: path.resolve(args[index + 1]) };
    }
    throw new Error(`Unknown argument: ${value}`);
  }, { port: 18916, open: true });
}

function defaultConnectionFile() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'HDS-Simulator/connection.json');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/HDS-Simulator/connection.json');
  throw new Error('This bundle supports Windows and macOS');
}

async function start(options) {
  const connectionFile = options.connectionFile || defaultConnectionFile();
  const attempts = options.port === 0 ? [0] : Array.from({ length: Math.min(10, 65536 - options.port) }, (_, index) => options.port + index);
  for (const port of attempts) {
    try {
      return await startServer({ port, connectionFile });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`No free local port in ${attempts[0]}-${attempts.at(-1)}`);
}

function openBrowser(url) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/' || target.search || target.hash) throw new Error('Invalid local browser URL');
  const command = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32/rundll32.exe') : '/usr/bin/open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', target.href] : [target.href];
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.error(`Open this address in your browser: ${target.href}`));
  child.unref();
}

try {
  const options = argumentsForLaunch(process.argv.slice(2));
  const server = await start(options);
  console.log(`HDS Simulator: ${server.url}`);
  console.log(`Private API connection file: ${server.connectionFile}`);
  console.log('Keep this window open. Press Ctrl+C to stop.');
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close().catch(error => { console.error(error.message); process.exitCode = 1; });
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
  if (options.open) openBrowser(server.url);
} catch (error) {
  console.error(`HDS Simulator could not start: ${error.message}`);
  process.exitCode = 1;
}
