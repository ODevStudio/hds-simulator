import { constants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const app = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(app, '../..');
const nodeVersion = '22.23.3';

function argumentsForPackage(args) {
  const allowed = ['--output', '--libraries', '--mac-cache', '--node'];
  if (args.length % 2 !== 0) throw new Error('Options require values');
  const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => {
    const key = args[index * 2];
    if (!allowed.includes(key)) throw new Error(`Unknown option: ${key}`);
    return [key.slice(2), path.resolve(args[index * 2 + 1])];
  }));
  if (!options.output || !options['mac-cache']) throw new Error('Pass --output NEW_DIRECTORY and --mac-cache VERIFIED_RUNTIME_CACHE');
  return { ...options, libraries: options.libraries || path.join(root, '.pio.nosync/libdeps/esp32s3'), node: options.node || process.execPath };
}

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function copy(source, target) {
  const status = await fs.lstat(source);
  if (status.isSymbolicLink()) throw new Error(`Refusing source link: ${source}`);
  if (status.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const name of (await fs.readdir(source)).sort()) await copy(path.join(source, name), path.join(target, name));
  } else if (status.isFile()) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
  } else throw new Error(`Not an ordinary file: ${source}`);
}

async function write(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents, { flag: 'wx' });
}

async function fetchLicense(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`License download failed: ${response.status} ${url}`);
  const text = await response.text();
  if (text.length > 1048576 || text.includes('<!DOCTYPE HTML')) throw new Error(`Unexpected license content: ${url}`);
  return text;
}

async function licenses(options) {
  const urls = {
    'Node.js-LICENSE': `https://raw.githubusercontent.com/nodejs/node/v${nodeVersion}/LICENSE`,
    'Emscripten-LICENSE': 'https://raw.githubusercontent.com/emscripten-core/emscripten/3.1.74/LICENSE',
    'OFL-1.1.txt': 'https://openfontlicense.org/documents/OFL.txt',
    'GPL-2.0.txt': 'https://raw.githubusercontent.com/gcc-mirror/gcc/master/COPYING',
    'FreeUniversal.md': 'https://raw.githubusercontent.com/wiki/olikraus/u8g2/fntgrpfreeuniversal.md',
    'Logisoso.md': 'https://raw.githubusercontent.com/wiki/olikraus/u8g2/fntgrplogisoso.md',
    'Lucida.md': 'https://raw.githubusercontent.com/wiki/olikraus/u8g2/fntgrplucida.md',
  };
  const downloaded = await Promise.all(Object.entries(urls).map(async ([name, url]) => {
    const contents = await fetchLicense(url);
    const notice = name.endsWith('.md') ? `Source: ${url}\n\n${contents.split('# Font Details')[0]}` : contents;
    return [name, notice];
  }));
  const local = {
    'HDS-GPL-3.0.txt': path.join(root, 'LICENSE'),
    'U8g2-LICENSE': path.join(options.libraries, 'U8g2/LICENSE'),
    'ArduinoJson-LICENSE': path.join(options.libraries, 'ArduinoJson/LICENSE.txt'),
    'ws-LICENSE': path.join(app, 'node_modules/ws/LICENSE'),
    'Lucide-LICENSE': path.join(app, 'assets/lucide-LICENSE'),
  };
  return { downloaded, local, urls };
}

async function runtimes(options) {
  const version = (await execute(options.node, ['--version'], { windowsHide: true })).stdout.trim();
  if (version !== `v${nodeVersion}` || path.extname(options.node).toLowerCase() !== '.exe') throw new Error(`Expected Windows Node.js ${nodeVersion} executable`);
  const provenance = JSON.parse(await fs.readFile(path.join(options['mac-cache'], 'macos-provenance.json'), 'utf8'));
  if (provenance.version !== nodeVersion || provenance.source !== `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`) throw new Error('Unexpected Mac runtime provenance');
  const sums = await fs.readFile(provenance.officialShasumsPath, 'utf8');
  const mac = await Promise.all(provenance.runtimes.map(async runtime => {
    if (!['darwin-arm64', 'darwin-x64'].includes(runtime.platform)) throw new Error('Unexpected Mac architecture');
    const name = `node-v${nodeVersion}-${runtime.platform}.tar.gz`;
    const official = sums.split(/\r?\n/).find(line => line.endsWith(`  ${name}`))?.slice(0, 64);
    if (!official || official !== await hash(runtime.archivePath) || official !== runtime.archiveSha256 ||
      runtime.archiveUrl !== `https://nodejs.org/dist/v${nodeVersion}/${name}` || runtime.binaryArchiveMode !== '0755') throw new Error(`Unverified runtime archive: ${runtime.platform}`);
    if (await hash(runtime.binaryPath) !== runtime.binarySha256 || await hash(runtime.licensePath) !== runtime.licenseSha256) throw new Error(`Runtime cache changed: ${runtime.platform}`);
    return { platform: runtime.platform, name: runtime.platform === 'darwin-arm64' ? 'macOS-Apple-Silicon' : 'macOS-Intel',
      binary: runtime.binaryPath, binarySha256: runtime.binarySha256, archiveSha256: official, archiveUrl: runtime.archiveUrl };
  }));
  if (new Set(mac.map(runtime => runtime.platform)).size !== 2) throw new Error('Both Mac architectures are required');
  return [{ platform: 'win32-x64', name: 'Windows-x64', binary: options.node, binarySha256: await hash(options.node) }, ...mac];
}

async function inventory(directory, prefix = '') {
  const entries = await fs.readdir(path.join(directory, prefix), { withFileTypes: true });
  const groups = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
    const relative = path.posix.join(prefix.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) return inventory(directory, relative);
    if (!entry.isFile()) throw new Error(`Unexpected package entry: ${relative}`);
    return [{ path: relative, bytes: (await fs.stat(path.join(directory, relative))).size, sha256: await hash(path.join(directory, relative)) }];
  }));
  return groups.flat();
}

async function buildBundle(options, runtime, metadata, notices, firmwareFiles) {
  const target = path.join(options.output, `HDS-Simulator-${runtime.name}`);
  await fs.mkdir(target);
  const appFiles = ['index.html', 'styles.css', 'package.json', 'package-lock.json', 'server.mjs', 'API.md', 'README.md',
    'src', 'assets', 'server', 'node_modules/ws', 'dist/renderer.mjs', 'dist/renderer.wasm', 'dist/renderer-meta.json', 'tools/control-example.mjs'];
  for (const name of appFiles) await copy(path.join(app, name), path.join(target, 'app', name));
  for (const name of ['launch.mjs', 'START-HERE.md']) await copy(path.join(app, 'packaging', name), path.join(target, name));
  const windows = runtime.platform === 'win32-x64';
  const start = windows ? 'START.cmd' : 'START.command';
  const startText = await fs.readFile(path.join(app, 'packaging', start), 'utf8');
  await write(path.join(target, start), windows ? startText.replace(/\r?\n/g, '\r\n') : startText.replace(/\r/g, ''));
  await copy(runtime.binary, path.join(target, 'runtime', windows ? 'node.exe' : 'node'));
  await copy(path.join(root, 'LICENSE'), path.join(target, 'LICENSE'));
  for (const [name, file] of Object.entries(notices.local)) await copy(file, path.join(target, 'licenses', name));
  for (const [name, contents] of notices.downloaded) await write(path.join(target, 'licenses', name), contents);
  await write(path.join(target, 'runtime/LICENSE'), notices.downloaded.find(([name]) => name === 'Node.js-LICENSE')[1]);
  const fonts = await fs.readFile(path.join(options.libraries, 'U8g2/src/clib/u8g2_fonts.c'), 'utf8');
  const names = ['logisoso22_tf', 'logisoso24_tf', 'logisoso32_tf', 'luBS18_tr', 'helvR10_tr', 'fub14_tr', '5x7_tr', '5x8_tr', '6x10_tr', '6x12_tr', '6x13_tr'];
  const fontNotices = names.map(name => {
    const position = fonts.indexOf(`const uint8_t u8g2_font_${name}[`);
    if (position < 0) throw new Error(`Missing font source: ${name}`);
    return `u8g2_font_${name}\n${fonts.slice(fonts.lastIndexOf('/*', position), position).trim()}`;
  });
  await write(path.join(target, 'licenses/Font-copyright-notices.txt'), fontNotices.join('\n\n') + '\n');
  for (const name of firmwareFiles) await copy(path.join(root, name), path.join(target, 'sources/firmware', name));
  for (const name of ['renderer/renderer.cpp', 'renderer/adapter.h', 'packaging', 'tools/package.mjs', 'tools/archive-package.py']) await copy(path.join(app, name), path.join(target, 'sources/firmware/examples/hds-simulator', name));
  for (const name of ['U8g2', 'ArduinoJson']) {
    await copy(path.join(options.libraries, name, 'src'), path.join(target, 'sources/vendor', name, 'src'));
    await copy(path.join(options.libraries, name, 'library.properties'), path.join(target, 'sources/vendor', name, 'library.properties'));
  }
  await copy(path.join(app, 'packaging/SOURCES.md'), path.join(target, 'sources/README.md'));
  const files = await inventory(target);
  if (files.some(file => /(^|\/)(\.git|\.pio[^/]*|\.env|connection\.json|.*\.pem|.*\.exe\.tmp|renderer-native\.exe|emsdk)(\/|$)/i.test(file.path))) throw new Error('Private or build artifacts entered the bundle');
  await write(path.join(target, 'package-manifest.json'), JSON.stringify({ formatVersion: 1, platform: runtime.platform,
    nodeVersion, renderer: metadata, runtime: { sha256: runtime.binarySha256, archiveSha256: runtime.archiveSha256, archiveUrl: runtime.archiveUrl },
    licenseSources: notices.urls, files }, null, 2) + '\n');
  if (!windows) {
    await execute(process.env.PYTHON || 'python', [path.join(app, 'tools/archive-package.py'), target, `${target}.tar.gz`], { windowsHide: true });
  }
  return { platform: runtime.platform, folder: target, archive: windows ? null : `${target}.tar.gz`, files: files.length + 1 };
}

async function main() {
  const options = argumentsForPackage(process.argv.slice(2));
  if (options.output === root || options.output.startsWith(root + path.sep)) throw new Error('Choose a new output directory outside the repository');
  try { await fs.lstat(options.output); throw new Error('Output already exists; choose a new directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const metadata = JSON.parse(await fs.readFile(path.join(app, 'dist/renderer-meta.json'), 'utf8'));
  for (const [name, expected] of Object.entries(metadata.sourceHashes)) {
    if (await hash(path.join(root, name)) !== expected) throw new Error(`Renderer/source mismatch: ${name}`);
  }
  const ws = JSON.parse(await fs.readFile(path.join(app, 'node_modules/ws/package.json'), 'utf8'));
  if (ws.version !== '8.22.2') throw new Error('Expected ws 8.22.2');
  const runtimeList = await runtimes(options);
  const notices = await licenses(options);
  const tracked = (await execute('git', ['ls-files', '-z', '--', 'include', 'src', 'LICENSE', 'platformio.ini', 'tools/build_hds_simulator.py'], { cwd: root, encoding: 'utf8' })).stdout.split('\0').filter(Boolean);
  if (!tracked.includes('src/hds.ino') || !tracked.includes('tools/build_hds_simulator.py')) throw new Error('Missing corresponding firmware source');
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.mkdir(options.output);
  for (const runtime of runtimeList) console.log(JSON.stringify(await buildBundle(options, runtime, metadata, notices, tracked)));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
