import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server/control-server.mjs';

export { startServer };

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!['--port', '--connection-file'].includes(name) || value === undefined || value.startsWith('--')) throw new Error('Usage: node server.mjs [--port 18916] [--connection-file path]');
    if (name === '--port') {
      if (!/^\d{1,5}$/.test(value)) throw new Error('Port must be 0-65535');
      options.port = Number(value);
    } else options.connectionFile = path.resolve(value);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startServer(parseArguments(process.argv.slice(2)));
    console.log(`Simulator: ${server.url}`);
    console.log(`Connection file: ${server.connectionFile}`);
    const stop = () => server.close().catch(error => { console.error(error.message); process.exitCode = 1; });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
