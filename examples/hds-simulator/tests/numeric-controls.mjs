import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.HDS_SCREENSHOTS || path.join(root, '.pio.nosync/hds-simulator-checks');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hds-simulator-numeric-'));
const fields = [
  { id: 'weight', key: 'grossWeight', initial: 100, step: 0.1, min: -10000, max: 10000, draft: '125.4', invalid: '12.34' },
  { id: 'pour-rate', key: 'pourRate', initial: 3, step: 1, min: 0, max: 1000, draft: '7', invalid: '3.5' },
];
const errors = [];
let checks = 0;
let server;
let browser;
const check = (condition, message) => { assert(condition, message); checks++; };
const current = page => page.evaluate(async () => (await import('./src/app.mjs')).getSnapshot());

async function expectValue(page, field, expected, label) {
  const actual = (await current(page)).controls[field.key];
  check(Math.abs(actual - expected) < 1e-7, `${label}: expected ${expected}, got ${actual}`);
}

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(server.url);
  await page.evaluate(async () => {
    const app = await import('./src/app.mjs');
    await app.ready;
    app.advanceTime(1000);
  });
  check((await current(page)).controls.pourRate === 3, 'Default pour rate is 3 g/s');
  return page;
}

async function exerciseField(page, field, label) {
  const input = page.locator(`#${field.id}`);
  const up = page.locator(`#${field.id}-step-up`);
  const down = page.locator(`#${field.id}-step-down`);
  const attributes = await input.evaluate(element => ({ type: element.type, min: Number(element.min), max: Number(element.max), step: Number(element.step), appearance: getComputedStyle(element).appearance }));
  check(attributes.type === 'number' && attributes.min === field.min && attributes.max === field.max && attributes.step === field.step, `${label}: native numeric rules remain intact`);
  check(attributes.appearance === 'textfield', `${label}: native mouse autorepeat spinner is hidden`);
  await input.fill(String(field.initial));
  await expectValue(page, field, field.initial, `${label}: valid input commits before blur`);
  await up.click();
  await expectValue(page, field, field.initial + field.step, `${label}: one up click is one step`);
  await down.click();
  await expectValue(page, field, field.initial, `${label}: one down click is one step`);
  for (let index = 0; index < 10; index++) {
    await up.click();
    await page.waitForTimeout(55);
  }
  await expectValue(page, field, field.initial + field.step * 10, `${label}: ten clicks accumulate across redraws`);
  await input.fill(String(field.initial));
  const box = await up.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await expectValue(page, field, field.initial, `${label}: held pointer has not activated`);
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.waitForTimeout(120);
  await expectValue(page, field, field.initial + field.step, `${label}: 1200ms hold activates once on release`);
  await input.fill(field.draft);
  await page.waitForTimeout(220);
  await expectValue(page, field, Number(field.draft), `${label}: typed value follows live state before blur`);
  check(await input.inputValue() === field.draft, `${label}: redraw preserves focused draft`);
  for (const draft of ['', field.invalid, String(field.max + field.step)]) {
    await input.fill(draft);
    await page.waitForTimeout(120);
    await expectValue(page, field, Number(field.draft), `${label}: invalid draft does not change state`);
    check(await up.isDisabled() && await down.isDisabled(), `${label}: invalid draft disables both steppers`);
    check(await input.inputValue() === draft, `${label}: invalid draft is not overwritten`);
  }
  await input.fill(String(field.min));
  check(await down.isDisabled() && await up.isEnabled(), `${label}: minimum disables only down`);
  await down.evaluate(button => button.click());
  await expectValue(page, field, field.min, `${label}: disabled minimum cannot step`);
  await up.click();
  await expectValue(page, field, field.min + field.step, `${label}: step up from minimum`);
  await input.fill(String(field.max));
  check(await up.isDisabled() && await down.isEnabled(), `${label}: maximum disables only up`);
  await up.evaluate(button => button.click());
  await expectValue(page, field, field.max, `${label}: disabled maximum cannot step`);
  await down.click();
  await expectValue(page, field, field.max - field.step, `${label}: step down from maximum`);
  await input.fill(String(field.initial));
  await input.press('ArrowUp');
  await expectValue(page, field, field.initial + field.step, `${label}: native ArrowUp commits before blur`);
  await input.press('ArrowDown');
  await expectValue(page, field, field.initial, `${label}: native ArrowDown follows numeric step`);
  await up.focus();
  await page.keyboard.down('Enter');
  for (let index = 0; index < 5; index++) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expectValue(page, field, field.initial + field.step, `${label}: repeated Enter does not autorepeat`);
  await page.keyboard.press('Space');
  await expectValue(page, field, field.initial + field.step * 2, `${label}: Space activates once`);
}

async function checkLayout(page, name, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.locator('.control-section').first().scrollIntoViewIfNeeded();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal page overflow at ${width}px`);
  for (const field of fields) {
    for (const id of [field.id, `${field.id}-step-up`, `${field.id}-step-down`]) {
      const bounds = await page.locator(`#${id}`).boundingBox();
      check(bounds && bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${name}: ${id} fits at ${width}px`);
    }
  }
  await page.locator('.control-section').first().screenshot({ path: path.join(output, `numeric-${name}-${width}.png`) });
}

try {
  await fs.mkdir(output, { recursive: true });
  server = await startServer({ port: 0, connectionFile: path.join(temporary, 'connection.json') });
  for (const [name, browserType, executablePath] of [
    ['chromium', chromium, process.env.PLAYWRIGHT_CHROMIUM_PATH],
    ['firefox', firefox, process.env.PLAYWRIGHT_FIREFOX_PATH],
  ]) {
    browser = await browserType.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const page = await open(context);
    for (const playing of [false, true]) {
      await page.evaluate(async playing => (await import('./src/app.mjs')).setPlaying(playing), playing);
      for (const field of fields) await exerciseField(page, field, `${name} ${playing ? 'playing' : 'paused'} ${field.id}`);
    }
    for (const width of [1440, 390, 320]) await checkLayout(page, name, width);
    await context.close();
    if (name === 'chromium') {
      const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const mobile = await open(touch);
      for (const field of fields) {
        await mobile.locator(`#${field.id}`).fill(String(field.initial));
        await mobile.locator(`#${field.id}-step-up`).tap();
        await expectValue(mobile, field, field.initial + field.step, `${field.id}: touch tap increments once`);
        await mobile.locator(`#${field.id}-step-down`).tap();
        await expectValue(mobile, field, field.initial, `${field.id}: touch tap decrements once`);
      }
      await checkLayout(mobile, 'chromium-touch', 390);
      await touch.close();
    }
    await browser.close();
    browser = null;
  }
  check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  console.log(`HDS numeric controls passed: ${checks} Chromium/Firefox checks; screenshots: ${output}`);
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('hds-simulator-numeric-'));
  await fs.rm(temporary, { recursive: true, force: true });
}
