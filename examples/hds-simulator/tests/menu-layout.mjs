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
assert.equal(menuRowsPerPage, 4);
assert(renderer.metadata.simulatorCorrections.includes('demo-menu-four-row-button-sidebar'));
assert(renderer.metadata.simulatorCorrections.includes('demo-button-feedback-corner-lines'));
assert(renderer.metadata.simulatorCorrections.includes('demo-menu-xor-corner-icons'));
assert(!baseline.metadata.simulatorCorrections.some(value => value.startsWith('demo-menu-')), 'Reference must be the unchanged stable renderer');
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
const menuCases = [...profiles.flatMap((settings, profile) => menuIds.flatMap(id => menuDefinitions[id].flatMap((_, selected) =>
  [true, false].flatMap(screenFlipped => heldCases.map(held => {
    const state = createState({ ...settings, screenFlipped });
    const frame = snapshot({ ...state, now: 2000, screen: id, menu: { id, selected } });
    assert.equal(frame.menu.page, Math.floor(selected / 4) + 1);
    assert.equal(frame.menu.totalPages, Math.ceil(frame.menu.rows.length / 4));
    return { label: `${id} row${selected} profile${profile} rotation${screenFlipped} held${JSON.stringify(held)}`,
      snapshot: { ...base, ...frame, held } };
  }))))), ...[1, 2].flatMap(wakeOnWeight => [true, false].flatMap(screenFlipped => heldCases.map(held => {
  const state = createState({ ...defaults, wakeOnWeight, screenFlipped });
  const frame = snapshot({ ...state, now: 2000, screen: 'power', menu: { id: 'power', selected: 3 } });
  return { label: `power wake${wakeOnWeight} rotation${screenFlipped} held${JSON.stringify(held)}`,
    snapshot: { ...base, ...frame, held } };
})))];
for (const fixture of menuCases.filter(fixture => fixture.snapshot.screen === 'power')) {
  assert.equal(fixture.snapshot.menu.rows[3], `Weight Wake ${['o', '2', '3', '4'][fixture.snapshot.settings.wakeOnWeight]}`);
}
const syntheticCases = [
  { rows: ['Back', 'Status', 'About', 'Weight Wake 4'], selected: 3 },
  ...[0, 36, 63].map(selected => ({ rows: Array.from({ length: 64 }, (_, index) => `Item ${index + 1}`), selected })),
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
const iconCases = [...menuCases, ...syntheticCases, ...unchangedCases];
const cornerLineCases = [...menuCases, ...syntheticCases, ...unchangedCases.filter(fixture =>
  fixture.snapshot.screen === 'weighing' && !fixture.snapshot.prompt && !fixture.snapshot.shutdownUntil)].map(fixture => ({
  ...fixture, label: `lines ${fixture.label}`, snapshot: { ...fixture.snapshot, buttonFeedback: 'lines' },
}));
const suppressedLineCases = unchangedCases.filter(fixture => fixture.snapshot.screen !== 'weighing' || fixture.snapshot.prompt || fixture.snapshot.shutdownUntil).map(fixture => ({
  ...fixture, label: `suppressed lines ${fixture.label}`, snapshot: { ...fixture.snapshot, buttonFeedback: 'lines' },
}));
const xorMenuCases = [...menuCases, ...syntheticCases, ...unchangedCases.filter(fixture => fixture.snapshot.feedback)].map(fixture => ({
  ...fixture, label: `xor ${fixture.label}`, snapshot: { ...fixture.snapshot, buttonFeedback: 'xor' },
}));
const xorUnchangedCases = unchangedCases.filter(fixture => !fixture.snapshot.feedback).map(fixture => ({
  ...fixture, label: `unchanged xor ${fixture.label}`, snapshot: { ...fixture.snapshot, buttonFeedback: 'xor' },
}));
const invalidCases = [...menuCases.slice(0, 8), ...unchangedCases.slice(0, 8)].flatMap(fixture =>
  [undefined, null, {}, 1, true, 'unknown', 'LINES', 'XOR', 'lines\u0000junk', 'lines\u0000', 'xor\u0000junk', 'xor\u0000'].flatMap(buttonFeedback =>
    ['lines', 'xor'].flatMap(primeMode => [
      { ...fixture, label: `prime ${primeMode} ${fixture.label}`, snapshot: { ...fixture.snapshot, buttonFeedback: primeMode } },
      { ...fixture, primeMode, label: `feedback ${JSON.stringify(buttonFeedback)} after ${primeMode} ${fixture.label}`, snapshot: { ...fixture.snapshot, buttonFeedback } },
    ])));
const restorationCases = menuCases.slice(0, 8).flatMap(fixture => [
  { kind: 'weighing', snapshot: { ...base, weight: -999.9, timerMs: 123000, settings: { ...fixture.snapshot.settings, timeOnTop: false }, held: fixture.snapshot.held, buttonFeedback: 'icons' } },
  { kind: 'icons', snapshot: { ...fixture.snapshot, buttonFeedback: 'icons' } },
  { kind: 'lines', snapshot: { ...fixture.snapshot, buttonFeedback: 'lines' } },
].flatMap(target => [
  { label: `prime menu XOR before ${target.kind} ${fixture.label}`, snapshot: { ...fixture.snapshot, buttonFeedback: 'xor' } },
  { ...target, label: `restore ${target.kind} after menu XOR ${fixture.label}`, primeSnapshot: { ...fixture.snapshot, buttonFeedback: 'xor' } },
]));
const cases = [...iconCases, ...cornerLineCases, ...suppressedLineCases, ...xorMenuCases, ...xorUnchangedCases, ...invalidCases, ...restorationCases];
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

const lineSample = baseline.render({ ...base, screen: 'main', menu: { rows: ['H', 'H'], selected: 0 } });
const lineBody = Uint8Array.from(lineSample, (value, index) => index % 128 >= 10 ? value : 0);
const fontHeight = bounds(lineBody).height - bounds(textFrame('H')).height;
assert.equal(fontHeight, 15, 'Rows retain the original FONT_S line height');
const texts = [...new Set([...menuCases, ...syntheticCases].flatMap(fixture => fixture.snapshot.menu.rows))];
for (const text of texts) {
  assert.notDeepEqual(textFrame(text), textFrame(`${text}|`), `Full menu label must leave room for a trailing glyph: ${text}`);
}
const glyphs = [
  { name: 'circle', x: 113, y: 24, width: 15, height: 16,
    pixels: crop(baseline.render({ ...base, held: { circle: true, square: false } }), 113, 0, 15, 16) },
  { name: 'square', x: 114, y: 48, width: 14, height: 16,
    pixels: crop(baseline.render({ ...base, held: { circle: false, square: true } }), 0, 0, 14, 16) },
];
for (const glyph of glyphs) assert(glyph.pixels.some(Boolean), `Stable weighing provides the ${glyph.name} bitmap`);
let checkedMenus = 0;
for (const fixture of [...menuCases, ...syntheticCases]) {
  const frame = renderer.render(fixture.snapshot);
  const upright = fixture.snapshot.settings.screenFlipped ? frame : frame.toReversed();
  const stableFrame = baseline.render({ ...fixture.snapshot, held: heldCases[0] });
  const stable = fixture.snapshot.settings.screenFlipped ? stableFrame : stableFrame.toReversed();
  for (const glyph of glyphs) {
    assert(!crop(stable, glyph.x, glyph.y, glyph.width, glyph.height).some(Boolean), `Full labels cannot overlap the ${glyph.name} sidebar region: ${fixture.label}`);
  }
  const expected = Uint8Array.from(stable, (value, index) => {
    const x = index % 128, y = Math.floor(index / 128);
    return value || glyphs.some(glyph => fixture.snapshot.held[glyph.name] && x >= glyph.x && x < glyph.x + glyph.width &&
      y >= glyph.y && y < glyph.y + glyph.height && glyph.pixels[(y - glyph.y) * glyph.width + x - glyph.x]) ? 1 : 0;
  });
  assert.deepEqual(crop(upright, 0, 0, 128, 16), crop(stable, 0, 0, 128, 16), `Top counter and first row retain the original FONT_S pixels: ${fixture.label}`);
  assert.deepEqual(crop(upright, 0, 48, 113, 16), crop(stable, 0, 48, 113, 16), `Fourth row keeps its complete label beside Square: ${fixture.label}`);
  assert.deepEqual(upright, expected, `Four original rows at baselines15/30/45/60 plus the exact stacked weighing bitmaps: ${fixture.label}`);
  assert(!crop(upright, 113, 15, 15, 9).some(Boolean), `Counter-to-Circle gap stays blank: ${fixture.label}`);
  assert(!crop(upright, 113, 39, 15, 9).some(Boolean), `Circle-to-Square gap stays blank: ${fixture.label}`);
  const counterInk = bounds(Uint8Array.from(upright, (value, index) => index < 128 * 16 && index % 128 >= 113 ? value : 0));
  const iconInk = Object.fromEntries(glyphs.map(glyph => [glyph.name, bounds(Uint8Array.from(upright, (value, index) => {
    const x = index % 128, y = Math.floor(index / 128);
    return x >= glyph.x && x < glyph.x + glyph.width && y >= glyph.y && y < glyph.y + glyph.height ? value : 0;
  }))]));
  if (counterInk && iconInk.circle && iconInk.square) {
    assert.deepEqual([iconInk.circle.top - counterInk.top - counterInk.height,
      iconInk.square.top - iconInk.circle.top - iconInk.circle.height], [9, 9], `Sidebar ink has equal nine-pixel gaps: ${fixture.label}`);
  }
  checkedMenus++;
}
for (const fixture of unchangedCases) {
  assert.deepEqual(renderer.render(fixture.snapshot), baseline.render(fixture.snapshot), `Non-menu frame changed from stable: ${fixture.label}`);
}
for (const fixture of iconCases) {
  assert.deepEqual(renderer.render({ ...fixture.snapshot, buttonFeedback: 'icons' }), renderer.render(fixture.snapshot), `Explicit icons must match the unchanged default: ${fixture.label}`);
}
for (const fixture of cornerLineCases) {
  const actual = renderer.render(fixture.snapshot);
  const upright = fixture.snapshot.settings.screenFlipped ? actual : actual.toReversed();
  const stableFrame = baseline.render({ ...fixture.snapshot, held: heldCases[0] });
  const stable = fixture.snapshot.settings.screenFlipped ? stableFrame : stableFrame.toReversed();
  const expected = Uint8Array.from(stable, (value, index) => value || Math.floor(index / 128) < 2 &&
    (fixture.snapshot.held.circle && index % 128 < 32 || fixture.snapshot.held.square && index % 128 >= 96) ? 1 : 0);
  assert.deepEqual(upright, expected, `Lines add only positive thirty-two-by-two corner masks without sidebar icons: ${fixture.label}`);
  assert.deepEqual(crop(upright, 0, 62, 128, 2), crop(stable, 0, 62, 128, 2), `Line feedback preserves the bottom tare pixels: ${fixture.label}`);
}
for (const fixture of suppressedLineCases) {
  assert.deepEqual(renderer.render(fixture.snapshot), baseline.render(fixture.snapshot), `App Text and information/feedback priority suppress line feedback: ${fixture.label}`);
}
let selectionTextKept = 0;
let pageTextKept = 0;
let textInverted = 0;
for (const fixture of xorMenuCases) {
  const actual = renderer.render(fixture.snapshot);
  const flipped = fixture.snapshot.settings.screenFlipped;
  const upright = flipped ? actual : actual.toReversed();
  const stableFrame = baseline.render({ ...fixture.snapshot, held: heldCases[0] });
  const stable = flipped ? stableFrame : stableFrame.toReversed();
  const corners = glyphs.map(glyph => ({ ...glyph, y: 0,
    x: glyph.name === 'circle' ? flipped ? 113 : 0 : flipped ? 0 : 114,
  }));
  const activeCorner = index => corners.find(glyph => fixture.snapshot.held[glyph.name] && index % 128 >= glyph.x &&
    index % 128 < glyph.x + glyph.width && Math.floor(index / 128) < glyph.height);
  const bitmapAt = index => {
    const glyph = activeCorner(index);
    return glyph ? glyph.pixels[Math.floor(index / 128) * glyph.width + index % 128 - glyph.x] : 0;
  };
  const expected = Uint8Array.from(stable, (value, index) => value ^ bitmapAt(index));
  assert.deepEqual(upright, expected, `Menu and action feedback XOR only bitmap set bits at original button corners: ${fixture.label}`);
  const keptText = (left, right) => stable.some((value, index) => value && index % 128 >= left && index % 128 < right && activeCorner(index) && !bitmapAt(index));
  if (keptText(0, 10)) selectionTextKept++;
  if (keptText(105, 128)) pageTextKept++;
  if (stable.some((value, index) => value && bitmapAt(index))) textInverted++;
}
assert(selectionTextKept > 0, 'XOR fixtures preserve selection text beneath transparent bitmap zeroes');
assert(pageTextKept > 0, 'XOR fixtures preserve page-count text beneath transparent bitmap zeroes');
assert(textInverted > 0, 'XOR fixtures invert overlapping text beneath bitmap set bits');
for (const fixture of xorUnchangedCases) {
  assert.deepEqual(renderer.render(fixture.snapshot), baseline.render(fixture.snapshot), `XOR mode leaves weighing, tare and information screens unchanged: ${fixture.label}`);
}
let opaqueWeighingFrames = 0;
for (const fixture of restorationCases.filter(fixture => fixture.primeSnapshot)) {
  const stableFrame = baseline.render({ ...fixture.snapshot, held: fixture.kind === 'weighing' ? fixture.snapshot.held : heldCases[0] });
  const stable = fixture.snapshot.settings.screenFlipped ? stableFrame : stableFrame.toReversed();
  if (fixture.kind === 'weighing') {
    const unheldFrame = baseline.render({ ...fixture.snapshot, held: heldCases[0] });
    const unheld = fixture.snapshot.settings.screenFlipped ? unheldFrame : unheldFrame.toReversed();
    const corners = glyphs.map(glyph => ({ ...glyph, y: 0,
      x: glyph.name === 'circle' ? fixture.snapshot.settings.screenFlipped ? 113 : 0 : fixture.snapshot.settings.screenFlipped ? 0 : 114,
    }));
    if (unheld.some((value, index) => value && !stable[index] && corners.some(glyph => fixture.snapshot.held[glyph.name] && index % 128 >= glyph.x &&
      index % 128 < glyph.x + glyph.width && Math.floor(index / 128) < glyph.height && !glyph.pixels[Math.floor(index / 128) * glyph.width + index % 128 - glyph.x]))) opaqueWeighingFrames++;
  }
  const expected = fixture.kind === 'weighing' ? stable : Uint8Array.from(stable, (value, index) => {
    const x = index % 128, y = Math.floor(index / 128);
    const indicator = fixture.kind === 'lines' ? y < 2 && (fixture.snapshot.held.circle && x < 32 || fixture.snapshot.held.square && x >= 96) :
      glyphs.some(glyph => fixture.snapshot.held[glyph.name] && x >= glyph.x && x < glyph.x + glyph.width && y >= glyph.y && y < glyph.y + glyph.height && glyph.pixels[(y - glyph.y) * glyph.width + x - glyph.x]);
    return value || indicator ? 1 : 0;
  });
  renderer.render(fixture.primeSnapshot);
  const actual = renderer.render(fixture.snapshot);
  assert.deepEqual(fixture.snapshot.settings.screenFlipped ? actual : actual.toReversed(), expected, `Menu XOR restores graphics state before subsequent frames: ${fixture.label}`);
}
assert(opaqueWeighingFrames > 0, 'Restoration fixtures require bitmap mode zero to clear lit weighing text under bitmap zeroes');
for (const fixture of invalidCases.filter(fixture => fixture.primeMode)) {
  renderer.render({ ...fixture.snapshot, buttonFeedback: fixture.primeMode });
  assert.deepEqual(renderer.render(fixture.snapshot), renderer.render({ ...fixture.snapshot, buttonFeedback: 'icons' }), `Invalid native feedback modes restore icons after ${fixture.primeMode}: ${fixture.label}`);
}
console.log(`Menu layout passed: ${checkedMenus} menu frames with stable-font/icon references; ${unchangedCases.length} unchanged weighing/info/feedback frames; ${cornerLineCases.length + suppressedLineCases.length} line-mode frames; ${xorMenuCases.length + xorUnchangedCases.length} XOR frames; ${cases.length} native/WASM comparisons`);
