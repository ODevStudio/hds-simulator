import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRenderer } from '../src/renderer.mjs';
import { createState, defaults, snapshot } from '../src/state.mjs';
import { menuDefinitions, menuIds, menuRowsPerPage } from '../src/menus.mjs';

const native = process.argv[2] || process.env.HDS_NATIVE_RENDERER;
const baselinePath = process.argv[3] || process.env.HDS_BASELINE_RENDERER;
assert(native, 'Pass the built native renderer as argv2 or HDS_NATIVE_RENDERER');
assert(baselinePath, 'Pass the stable src/renderer.mjs as argv3 or HDS_BASELINE_RENDERER');
const baselineUrl = pathToFileURL(path.resolve(baselinePath));
const { createRenderer: createBaseline } = await import(baselineUrl.href);
const baseline = await createBaseline({ wasmBinary: await readFile(new URL('../dist/renderer.wasm', baselineUrl)) });
const renderer = await createRenderer({ wasmBinary: await readFile(new URL('../dist/renderer.wasm', import.meta.url)) });
assert.equal(menuRowsPerPage, 3);
assert(renderer.metadata.simulatorCorrections.includes('demo-menu-three-row-button-header'));
assert(!baseline.metadata.simulatorCorrections.includes('demo-menu-three-row-button-header'), 'Reference must be the unchanged stable renderer');
assert.equal(baseline.metadata.u8g2Version, renderer.metadata.u8g2Version);

const base = {
  screen: 'weighing', now: 2000, weight: 0, timerMs: 0,
  settings: { ...defaults, screenFlipped: true },
  icons: { bleEnabled: true, bleConnected: true, wifiEnabled: false, batteryPercent: 75 },
  held: { circle: false, square: false },
  info: { firmwareVersion: 'FW: 3.1.16', buildDate: 'Nov 09 2026', revision: '6f2ac69',
    deviceName: 'hds-simulator', ssid: 'N/A', ip: '0.0.0.0', batteryVoltage: 3.8 },
  menu: { rows: ['Exit', 'Scale', 'Connections', 'Display', 'Power', 'Info'], selected: 0 },
};
const heldCases = [
  { circle: false, square: false }, { circle: true, square: false },
  { circle: false, square: true }, { circle: true, square: true },
];
const profiles = [defaults, { ...defaults,
  ...Object.fromEntries(Object.entries(defaults).filter(([, value]) => typeof value === 'boolean').map(([key, value]) => [key, !value])),
  driftCompensation: 0.075, wakeOnWeight: 3,
}];
const menuCases = profiles.flatMap((settings, profile) => menuIds.flatMap(id => menuDefinitions[id].flatMap((_, selected) =>
  [true, false].flatMap(screenFlipped => heldCases.map(held => {
    const state = createState({ ...settings, screenFlipped });
    const frame = snapshot({ ...state, now: 2000, screen: id, menu: { id, selected } });
    assert.equal(frame.menu.page, Math.floor(selected / 3) + 1);
    assert.equal(frame.menu.totalPages, Math.ceil(frame.menu.rows.length / 3));
    return { label: `${id} row${selected} profile${profile} rotation${screenFlipped} held${JSON.stringify(held)}`,
      snapshot: { ...base, ...frame, held } };
  })))));
const syntheticCases = [
  { rows: ['Back', 'Status', 'About'], selected: 2 },
  ...[0, 30, 63].map(selected => ({ rows: Array.from({ length: 64 }, (_, index) => `Item ${index + 1}`), selected })),
].flatMap(menu => [true, false].flatMap(screenFlipped => heldCases.map(held => ({
  label: `synthetic${menu.rows.length} row${menu.selected} rotation${screenFlipped} held${JSON.stringify(held)}`,
  snapshot: { ...base, screen: 'main', menu, settings: { ...base.settings, screenFlipped }, held },
}))));
const unchangedCases = [
  ...['weighing', 'boot', 'setup', 'status', 'about', 'wifiStatus', 'batteryInfo', 'logo', 'logoSample', 'charging', 'off'].map(screen => ({ screen })),
  { screen: 'weighing', weight: -125.4, timerMs: 123000, settings: { timeOnTop: true } },
  { screen: 'weighing', weight: 1500.1 },
  { screen: 'weighing', tareUntil: 2400 },
  { screen: 'weighing', shutdownUntil: 4000 },
  { screen: 'weighing', prompt: { visible: true, startedAt: 0, text: 'Carpano Antica Sweet Vermouth: 31g' } },
  { screen: 'main', feedback: { text: 'Timer Top', text2: 'ON', until: 3000 } },
  { screen: 'main', feedback: { text: 'A very long feedback label', text2: '', until: 3000 } },
].flatMap(frame => [true, false].flatMap(screenFlipped => heldCases.map(held => ({
  label: `unchanged ${frame.screen} ${JSON.stringify(frame)} rotation${screenFlipped} held${JSON.stringify(held)}`,
  snapshot: { ...base, ...frame, settings: { ...base.settings, ...frame.settings, screenFlipped }, held },
}))));
const cases = [...menuCases, ...syntheticCases, ...unchangedCases];
const nativeResult = spawnSync(native, [], {
  input: cases.map(fixture => JSON.stringify(fixture.snapshot)).join('\n') + '\n',
  maxBuffer: 64 * 1024 * 1024,
});
assert.equal(nativeResult.status, 0, nativeResult.stderr?.toString());
assert.equal(nativeResult.stdout.length, cases.length * 8192);
for (const [index, fixture] of cases.entries()) {
  assert.deepEqual(Buffer.from(renderer.render(fixture.snapshot)), nativeResult.stdout.subarray(index * 8192, (index + 1) * 8192), `Native/WASM mismatch: ${fixture.label}`);
}

function crop(frame, x, y, width, height) {
  return Buffer.from(Array.from({ length: height }, (_, row) => Array.from(frame.subarray((y + row) * 128 + x, (y + row) * 128 + x + width))).flat());
}

function bounds(frame) {
  const positions = Array.from(frame, (value, index) => value ? index : -1).filter(index => index >= 0);
  if (!positions.length) return null;
  const xs = positions.map(index => index % 128);
  const ys = positions.map(index => Math.floor(index / 128));
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left + 1, height: Math.max(...ys) - top + 1 };
}

function textFrame(text) {
  const frame = baseline.render({ ...base, screen: 'main', menu: { rows: [text], selected: 0 } });
  return Uint8Array.from(frame, (value, index) => index % 128 >= 10 ? value : 0);
}

const marker = baseline.render({ ...base, screen: 'main', menu: { rows: [''], selected: 0 } });
const lineSample = baseline.render({ ...base, screen: 'main', menu: { rows: ['H', 'H'], selected: 0 } });
const lineBody = Uint8Array.from(lineSample, (value, index) => index % 128 >= 10 ? value : 0);
const fontHeight = bounds(lineBody).height - bounds(textFrame('H')).height;
assert.equal(fontHeight, 15, 'Rows retain the original FONT_S line height');
const texts = [...new Set([...menuCases, ...syntheticCases].flatMap(fixture => fixture.snapshot.menu.rows))];
for (const text of texts) {
  assert.notDeepEqual(textFrame(text), textFrame(`${text}|`), `Full menu label must leave room for a trailing glyph: ${text}`);
}
let checkedMenus = 0;
for (const fixture of [...menuCases, ...syntheticCases]) {
  const frame = renderer.render(fixture.snapshot);
  const upright = fixture.snapshot.settings.screenFlipped ? frame : frame.toReversed();
  const weighingFrame = baseline.render({ ...base, settings: fixture.snapshot.settings, held: fixture.snapshot.held });
  const weighing = fixture.snapshot.settings.screenFlipped ? weighingFrame : weighingFrame.toReversed();
  assert.deepEqual(crop(upright, 0, 0, 15, 16), crop(weighing, 0, 0, 15, 16), `Left icon must match stable weighing: ${fixture.label}`);
  assert.deepEqual(crop(upright, 113, 0, 15, 16), crop(weighing, 113, 0, 15, 16), `Right icon must match stable weighing: ${fixture.label}`);
  const header = Uint8Array.from(upright, (value, index) => index < 128 * 16 && index % 128 >= 15 && index % 128 < 113 ? value : 0);
  const actualBounds = bounds(header);
  const page = Math.floor(fixture.snapshot.menu.selected / 3) + 1;
  const total = Math.ceil(fixture.snapshot.menu.rows.length / 3);
  if (total === 1) assert.equal(actualBounds, null, `Single-page header has no counter: ${fixture.label}`);
  else {
    const reference = textFrame(`${page}/${total}`);
    const expectedBounds = bounds(reference);
    assert(actualBounds, `Page count is visible: ${fixture.label}`);
    assert.equal(actualBounds.top, expectedBounds.top, `Page count keeps the original FONT_S baseline: ${fixture.label}`);
    assert(Math.abs(actualBounds.left + (actualBounds.width - 1) / 2 - 63.5) <= 1, `Page count must be centered clear of icons: ${fixture.label}`);
    assert(actualBounds.left > 15 && actualBounds.left + actualBounds.width < 113, `Page count cannot collide with icons: ${fixture.label}`);
    assert.deepEqual(crop(header, actualBounds.left, actualBounds.top, actualBounds.width, actualBounds.height),
      crop(reference, expectedBounds.left, expectedBounds.top, expectedBounds.width, expectedBounds.height), `Page count keeps the original FONT_S glyph pixels: ${fixture.label}`);
  }
  const first = (page - 1) * 3;
  const rows = fixture.snapshot.menu.rows.slice(first, first + 3).map(textFrame);
  const expectedBody = Uint8Array.from({ length: 128 * 48 }, (_, index) => {
    const x = index % 128, y = Math.floor(index / 128);
    return rows.some((row, offset) => {
      const sourceY = y - offset * fontHeight;
      if (sourceY < 0 || sourceY >= 64) return false;
      return x >= 10 ? row[sourceY * 128 + x] : first + offset === fixture.snapshot.menu.selected && marker[sourceY * 128 + x];
    }) ? 1 : 0;
  });
  assert.deepEqual(crop(upright, 0, 16, 128, 48), Buffer.from(expectedBody), `Rows must retain FONT_S at baselines31/46/61 without header overlap or extra rows: ${fixture.label}`);
  checkedMenus++;
}
for (const fixture of unchangedCases) {
  assert.deepEqual(renderer.render(fixture.snapshot), baseline.render(fixture.snapshot), `Non-menu frame changed from stable: ${fixture.label}`);
}
console.log(`Menu layout passed: ${checkedMenus} menu frames with stable-font/icon references; ${unchangedCases.length} unchanged weighing/info/feedback frames; ${cases.length} native/WASM comparisons`);
