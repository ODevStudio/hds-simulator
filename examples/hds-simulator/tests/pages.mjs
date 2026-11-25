import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hds-simulator-pages-'));
const site = path.join(temporary, 'site');
const output = process.env.HDS_SCREENSHOTS || path.join(root, '.pio.nosync/hds-simulator-checks/pages');
const prefix = '/hds-simulator/';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };
let checks = 0;
let browser;
let server;
let errors = [];
let requests = [];
let sockets = [];
const check = (condition, message) => { assert(condition, message); checks++; };
const current = page => page.evaluate(async () => (await import('./src/app.mjs')).getSnapshot());
const step = (page, ms) => page.evaluate(async ms => (await import('./src/app.mjs')).advanceTime(ms), ms);
const pixels = page => page.locator('#oled').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 128, 64).data).filter((_, index) => index % 4 === 0));
const ready = page => page.evaluate(async () => { const app = await import('./src/app.mjs'); await app.ready; app.setPlaying(false); });
const reload = async page => { await page.reload(); await ready(page); };
const press = async (page, id, touch = false) => { await page.locator(`#${id}`)[touch ? 'tap' : 'click'](); };
const screenshot = async (page, name) => {
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.controls').scrollTo(0, 0); });
  await page.screenshot({ path: path.join(output, name), fullPage: true });
};

async function inventory(directory, relative = '') {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => {
    assert(entry.isFile() || entry.isDirectory(), 'Pages artifact contains only regular files and directories');
    const name = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? inventory(directory, name) : [name];
  }));
  return groups.flat().sort();
}

async function serve(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
  const relative = pathname.slice(prefix.length);
  const filename = path.resolve(site, !relative || relative.endsWith('/') ? `${relative}index.html` : relative);
  const inside = path.relative(site, filename);
  if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) { response.writeHead(403).end(); return; }
  try {
    if (!(await fs.stat(filename)).isFile()) { response.writeHead(404).end(); return; }
    const body = await fs.readFile(filename);
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
}

async function menuSetting(page, row, touch = false) {
  await page.locator('#scene').selectOption('display');
  for (let index = 0; index < row; index++) await press(page, 'circle', touch);
  await press(page, 'square', touch);
}

async function navigation(page, url, variant) {
  const selected = variant === 'current' ? 'Current' : 'Menu demo';
  const currentLink = page.getByRole('link', { name: 'Current', exact: true });
  const demoLink = page.getByRole('link', { name: 'Menu demo', exact: true });
  check(await currentLink.getAttribute('href') === (variant === 'current' ? './' : '../'), `${variant} Current link is relative`);
  check(await demoLink.getAttribute('href') === (variant === 'current' ? './demo/' : './'), `${variant} Menu demo link is relative`);
  check(await page.getByRole('link', { name: selected, exact: true }).getAttribute('aria-current') === 'page', `${variant} navigation identifies the active page`);
  check(await page.locator('[aria-current="page"]').count() === 1, `${variant} has exactly one current-page marker`);
  check(await page.locator('meta[name="hds-control-api"]').getAttribute('content') === '', `${variant} static API stays disabled`);
  const opposite = variant === 'current' ? demoLink : currentLink;
  const destination = new URL(variant === 'current' ? 'demo/' : '../', url).href;
  await opposite.click();
  await ready(page);
  check(page.url() === destination, `${variant} navigation opens the other simulator`);
  await page.goto(url);
  await ready(page);
}

async function screens(page, variant, viewport, touch) {
  const label = `${variant}-${viewport}`;
  await press(page, 'reset-defaults', touch);
  check((await current(page)).screen === 'boot', `${label} shows boot`);
  check((await pixels(page)).some(value => value > 100), `${label} boot OLED is nonblank`);
  await screenshot(page, `${label}-boot.png`);
  await step(page, 1000);
  check((await current(page)).screen === 'weighing', `${label} boot follows virtual time`);
  const lit = (await pixels(page)).filter(value => value > 100).length;
  check(lit > 0 && lit < 8192, `${label} weighing OLED contains actual raster pixels`);
  check(await page.locator('.scale-photo').evaluate(image => image.complete && image.naturalWidth === 2362), `${label} photograph loads`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} has no horizontal overflow`);
  if (viewport === 'desktop') check(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), `${label} fits the desktop viewport vertically`);
  await screenshot(page, `${label}-weighing.png`);
  await page.locator('#weight').fill('12.5');
  await press(page, 'tare', touch);
  check((await current(page)).weight === 0, `${label} visible tare control works`);
  check((await current(page)).controls.pourRate === 3, `${label} default pouring rate remains 3 g/s`);
  await press(page, 'pour', touch);
  check(Math.abs((await step(page, 2000)).weight - 6) < 0.001, `${label} pouring follows virtual time`);
  await press(page, 'pour', touch);
  await page.locator('#scene').selectOption('main');
  await press(page, 'circle', touch);
  check((await current(page)).menu.selected === 1, `${label} physical Circle navigates menus`);
  await press(page, 'square', touch);
  check((await current(page)).screen === 'scale', `${label} physical Square opens a submenu`);
  const menuPixels = await pixels(page);
  await page.locator('#circle').focus();
  await page.keyboard.down('c');
  await page.keyboard.down('s');
  const invertSides = menuPixels.map((value, index) => {
    const x = index % 128;
    return x < 12 || x >= 115 && x < 127 ? value === 186 ? 40 : 186 : value;
  });
  assert.deepEqual(await pixels(page), invertSides, `${label} shows the firmware XOR side lines`);
  checks++;
  await page.keyboard.up('s');
  await page.keyboard.up('c');
  await screenshot(page, `${label}-menu.png`);
  await menuSetting(page, 3, touch);
  await page.locator('#scene').selectOption('weighing');
  await page.locator('#ble-connected').check();
  await press(page, 'show-prompt', touch);
  check((await current(page)).prompt.visible, `${label} opt-in App Text works without a server API`);
  const initial = await pixels(page);
  await step(page, 1019);
  check(JSON.stringify(await pixels(page)) === JSON.stringify(initial), `${label} prompt initially holds`);
  await step(page, 1);
  check(JSON.stringify(await pixels(page)) !== JSON.stringify(initial), `${label} prompt scrolls on virtual time`);
  await screenshot(page, `${label}-scroll.png`);
}

async function isolation(currentPage, demoPage) {
  for (const page of [currentPage, demoPage]) await press(page, 'reset-defaults');
  await currentPage.evaluate(() => localStorage.setItem('hds-pages-unrelated', 'keep'));
  const key = page => page.evaluate(async () => (await import('./src/storage.mjs')).SETTINGS_KEY);
  const currentKey = await key(currentPage);
  const demoKey = await key(demoPage);
  check(currentKey === 'hds-simulator.settings.v1:/hds-simulator/', 'Current settings key includes its project directory');
  check(demoKey === 'hds-simulator.settings.v1:/hds-simulator/demo/', 'Demo settings key includes its own directory');
  check(currentKey !== demoKey, 'Current and demo settings have separate storage namespaces');
  await menuSetting(currentPage, 1);
  check((await current(currentPage)).settings.screenFlipped, 'Current setting changes through the actual menu');
  await reload(demoPage);
  check(!(await current(demoPage)).settings.screenFlipped, 'Current settings do not leak into demo after reload');
  await menuSetting(demoPage, 3);
  await reload(currentPage);
  check((await current(currentPage)).settings.screenFlipped && !(await current(currentPage)).settings.appTextEnabled, 'Current reload preserves only its own settings');
  await reload(demoPage);
  check((await current(demoPage)).settings.appTextEnabled && !(await current(demoPage)).settings.screenFlipped, 'Demo reload preserves only its own settings');
  await press(currentPage, 'reset-defaults');
  await reload(demoPage);
  check((await current(demoPage)).settings.appTextEnabled, 'Current reset does not reset demo settings');
  await menuSetting(currentPage, 1);
  await press(demoPage, 'reset-defaults');
  await reload(currentPage);
  check((await current(currentPage)).settings.screenFlipped, 'Demo reset does not reset current settings');
  await reload(demoPage);
  check(!(await current(demoPage)).settings.appTextEnabled, 'Demo reset persists in its own namespace');
  check(await currentPage.evaluate(() => localStorage.getItem('hds-pages-unrelated')) === 'keep', 'Both resets preserve unrelated origin storage');
}

try {
  await promisify(execFile)(process.execPath, [path.join(root, 'tools/build-pages.mjs'), '--current', root, '--demo', root, '--output', site], { timeout: 30000, windowsHide: true });
  const files = await inventory(site);
  check(files.every(file => !/(^|\/)(server|api|node_modules|packaging|tests|runtime|\.git|\.codegraph|\.pio[^/]*)(\/|$)/i.test(file) && !/(^|\/)(server\.mjs|connection\.json|package(?:-lock)?\.json)$/.test(file)), 'Pages artifact excludes servers, dependencies, tests and private/build files');
  for (const variant of ['', 'demo/']) {
    for (const file of ['index.html', 'styles.css', 'src/app.mjs', 'dist/renderer.mjs', 'dist/renderer.wasm', 'assets/hds-scale.png', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      check(files.includes(`${variant}${file}`), `Pages includes ${variant}${file}`);
    }
  }
  await fs.mkdir(output, { recursive: true });
  server = http.createServer((request, response) => { serve(request, response).catch(() => response.writeHead(500).end()); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) });
  for (const [name, viewport, touch] of [
    ['desktop', { width: 1440, height: 960 }, false],
    ['mobile', { width: 390, height: 844 }, true],
  ]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
    context.on('request', request => { requests = [...requests, request.url()]; });
    context.on('page', page => {
      page.on('pageerror', error => { errors = [...errors, error.message]; });
      page.on('console', message => { if (message.type() === 'error') errors = [...errors, message.text()]; });
      page.on('websocket', socket => { sockets = [...sockets, socket.url()]; });
    });
    const pages = await Promise.all(['', 'demo/'].map(async directory => {
      const page = await context.newPage();
      const url = `${origin}${prefix}${directory}`;
      await page.goto(url);
      await ready(page);
      return { page, url, variant: directory ? 'demo' : 'current' };
    }));
    for (const { page, url, variant } of pages) {
      await navigation(page, url, variant);
      await screens(page, variant, name, touch);
    }
    if (!touch) await isolation(pages[0].page, pages[1].page);
    await context.close();
  }
  check(requests.every(request => new URL(request).origin === origin), 'All static browser requests stay on the test origin');
  check(!requests.some(request => new URL(request).pathname.includes('/api/')) && sockets.length === 0, 'Static Pages makes no API configuration requests or WebSocket attempts');
  check(errors.length === 0, `Pages browser errors: ${errors.join('; ')}`);
  console.log(`HDS static Pages checks passed: ${checks}; screenshots: ${output}`);
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert(path.basename(temporary).startsWith('hds-simulator-pages-'));
  await fs.rm(temporary, { recursive: true, force: true });
}
