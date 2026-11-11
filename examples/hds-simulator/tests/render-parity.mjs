import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRenderer } from '../src/renderer.mjs';

const root = new URL('../../../', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('../dist/renderer-meta.json', import.meta.url), 'utf8'));
const native = process.argv[2] ?? process.env.HDS_NATIVE_RENDERER;
assert.ok(native, 'Build with --native, then pass its nativeExecutable as an argument or set HDS_NATIVE_RENDERER');
assert.equal(metadata.nativeExecutable, undefined);
assert.doesNotMatch(JSON.stringify(metadata), /[A-Za-z]:[/\\]/);
for (const [name, expected] of Object.entries(metadata.sourceHashes)) {
  const source = await readFile(new URL(name, root));
  assert.equal(createHash('sha256').update(source).digest('hex'), expected, `Stale production input: ${name}`);
}
const wasmBinary = await readFile(new URL('../dist/renderer.wasm', import.meta.url));
assert.doesNotMatch(wasmBinary.toString('latin1'), /(?:^|[^A-Za-z0-9])[A-Za-z]:[/\\]/);
const glue = await readFile(new URL('../dist/renderer.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(glue, /(?:^|[^A-Za-z0-9])[A-Za-z]:[/\\]/);
const renderer = await createRenderer({ wasmBinary });
assert.equal(renderer.metadata.sourceCommit, metadata.sourceCommit);
assert.equal(renderer.metadata.u8g2Version, '2.36.18');
assert.deepEqual(renderer.metadata.simulatorCorrections, metadata.simulatorCorrections);
assert.deepEqual(metadata.simulatorCorrections, ['usb-charging-icon-uses-actual-charging-state']);

const base = {
  screen: 'weighing', now: 2000, weight: 0, timerMs: 0,
  settings: { screenFlipped: true, timeOnTop: false, autoSleep: true, requireHeartbeat: true },
  icons: { bleEnabled: true, bleConnected: true, wifiEnabled: false, batteryPercent: 75 },
  held: { circle: false, square: false },
  info: { firmwareVersion: 'FW: 3.1.16', buildDate: 'Nov 09 2026', revision: '6f2ac69',
    deviceName: 'hds-simulator', ssid: 'N/A', ip: '0.0.0.0', batteryVoltage: 3.8 },
  menu: { rows: ['Exit', 'Scale', 'Connections', 'Display', 'Power', 'Info'], selected: 0 },
};
const fixtures = [];
const add = (snapshot) => {
  for (const screenFlipped of [true, false]) {
    fixtures.push({ ...base, ...snapshot, settings: { ...base.settings, ...snapshot.settings, screenFlipped } });
  }
};
for (const screen of ['boot', 'setup', 'weighing', 'main', 'scale', 'connections', 'display',
  'power', 'info', 'status', 'about', 'wifiStatus', 'batteryInfo', 'logo', 'logoSample', 'charging', 'off']) {
  add({ screen });
}
for (const weight of [-1000, -999.9, -0.1, 0, 0.1, 9.9, 10, 99.9, 100, 999.9, 1000, 1500, 1500.1]) {
  for (const timerMs of [0, 1000, 123000]) {
    for (const timeOnTop of [false, true]) add({ weight, timerMs, settings: { timeOnTop } });
  }
}
for (const selected of [0, 1, 3, 4, 5]) add({ screen: 'main', menu: { ...base.menu, selected } });
for (const now of [0, 499, 500, 999, 1000, 1500, 0xffffff00]) {
  add({ now, icons: { ...base.icons, bleConnected: false, batteryPercent: 0 } });
  add({ now, icons: { ...base.icons, wifiEnabled: true, wifiConnected: false } });
}
for (const held of [{ circle: true }, { square: true }, { circle: true, square: true }]) add({ held });
for (const batteryPercent of [0, 5, 6, 25, 26, 50, 51, 75, 76, 100]) {
  add({ icons: { ...base.icons, batteryPercent } });
}
add({ icons: { ...base.icons, usbPresent: true, charging: true } });
add({ tareUntil: 2400 });
add({ shutdownUntil: 5000 });
add({ screen: 'main', feedback: { text: 'Timer Top', text2: 'ON', until: 3000 } });
add({ screen: 'main', feedback: { text: 'A very long feedback label', text2: '', until: 3000 } });
for (const now of [0, 999, 1000, 1099, 1100, 1600, 8499, 8500, 9499, 9500]) {
  add({ now, prompt: { visible: true, startedAt: 0, text: 'Carpano Antica Sweet Vermouth: 31g' } });
}
add({ prompt: { visible: true, startedAt: 0, text: 'Add Gin: 35g' } });
add({ prompt: { visible: true, startedAt: 0, text: 'M'.repeat(128) } });
for (const offset of [0.25, 123456.75, 0xfffffe00 + 0.25]) {
  for (const elapsed of [0, 1099, 1100, 1600, 8500, 9499, 9500]) {
    add({ now: offset + elapsed, timerMs: 123456.75,
      prompt: { visible: true, startedAt: offset, text: 'Carpano Antica Sweet Vermouth: 31g' } });
  }
}
add({ now: 0xfffffe00 + 0.25, tareUntil: 0xfffffe00 + 400.75 });
add({ now: 0xfffffe00 + 0.25, shutdownUntil: 0xfffffe00 + 2900.75 });
add({ now: 0xfffffe00 + 0.25, screen: 'main',
  feedback: { text: 'Timer Top', text2: 'ON', until: 0xfffffe00 + 1000.75 } });

const batteryCases = [];
for (const screen of ['weighing', 'charging']) {
  for (const batteryPercent of [0, 5, 6, 25, 26, 50, 51, 75, 76, 100]) {
    for (const now of [2000, 2499, 2500, 2999]) {
      batteryCases.push({ index: fixtures.length, screen, batteryPercent, now });
      for (const [usbPresent, charging] of [[false, false], [true, false], [true, true]]) {
        add({ screen, now, icons: { ...base.icons, batteryPercent, usbPresent, charging } });
      }
    }
  }
}
const unchangedMenus = [];
for (const screen of ['main', 'scale', 'connections', 'display', 'power', 'info', 'status',
  'about', 'wifiStatus', 'logo', 'logoSample']) {
  unchangedMenus.push({ index: fixtures.length, screen });
  for (const charging of [false, true]) add({ screen, icons: { ...base.icons, usbPresent: true, charging } });
}

const nativeResult = spawnSync(native, [], {
  input: fixtures.map(value => JSON.stringify(value)).join('\n') + '\n',
  maxBuffer: 64 * 1024 * 1024,
});
assert.equal(nativeResult.status, 0, nativeResult.stderr?.toString());
assert.equal(nativeResult.stdout.length, fixtures.length * 8192);
for (const [index, snapshot] of fixtures.entries()) {
  const actual = renderer.render(snapshot);
  assert.equal(actual.length, 8192);
  assert.ok(actual.every(value => value === 0 || value === 1));
  const expected = nativeResult.stdout.subarray(index * 8192, (index + 1) * 8192);
  assert.deepEqual(Buffer.from(actual), expected, `Native/WASM mismatch at ${index}: ${JSON.stringify(snapshot)}`);
  const emptyBatteryBlink = snapshot.screen === 'charging' && !(snapshot.icons.usbPresent && snapshot.icons.charging) &&
    snapshot.icons.batteryPercent <= 5 && Math.floor(snapshot.now / 500) % 2 === 0;
  assert.equal(actual.some(Boolean), !emptyBatteryBlink, `Unexpected blank state at ${index}: ${snapshot.screen}`);
  if (index % 2 === 1 && !snapshot.held?.circle && !snapshot.held?.square) {
    const upright = renderer.render(fixtures[index - 1]);
    assert.deepEqual(actual, upright.toReversed(), `Rotation mismatch at ${index}`);
  }
}
for (const fixture of batteryCases) {
  for (const rotation of [0, 1]) {
    const index = fixture.index + rotation;
    const frame = offset => renderer.render(fixtures[index + offset]);
    const batteryOnly = frame(0), usbIdle = frame(2), charging = frame(4);
    const label = `${fixture.screen}, SOC ${fixture.batteryPercent}, phase ${fixture.now}, rotation ${rotation}`;
    assert.deepEqual(usbIdle, batteryOnly, `USB without charging must retain battery-level pixels: ${label}`);
    assert.notDeepEqual(charging, usbIdle, `Charging icon must remain distinct: ${label}`);
    for (let pixel = 0; pixel < charging.length; pixel++) {
      const upright = rotation === 0 ? pixel : charging.length - pixel - 1;
      if (upright % 128 < 121 || Math.floor(upright / 128) < 51) {
        assert.equal(charging[pixel], usbIdle[pixel], `Charging changed pixels outside its icon: ${label}, pixel ${pixel}`);
      }
    }
  }
}
for (const fixture of unchangedMenus) {
  for (const rotation of [0, 1]) {
    assert.deepEqual(renderer.render(fixtures[fixture.index + rotation]), renderer.render(fixtures[fixture.index + rotation + 2]),
      `Charging control must not add or replace menu icons: ${fixture.screen}, rotation ${rotation}`);
  }
}
const promptAt = now => renderer.render({ ...base, now,
  prompt: { visible: true, startedAt: 0, text: 'Carpano Antica Sweet Vermouth: 31g' } });
assert.deepEqual(promptAt(0), promptAt(1099));
assert.notDeepEqual(promptAt(0), promptAt(1100));
assert.deepEqual(promptAt(8500), promptAt(9499));
assert.deepEqual(promptAt(0), promptAt(9500));
for (const offset of [0.25, 123456.75, 0xfffffe00 + 0.25]) {
  for (const elapsed of [0, 1099, 1100, 1600, 8500, 9499, 9500]) {
    const snapshot = { ...base, now: offset + elapsed,
      prompt: { visible: true, startedAt: offset, text: 'Carpano Antica Sweet Vermouth: 31g' } };
    assert.deepEqual(renderer.render(snapshot), promptAt(elapsed), `Fractional clock offset ${offset}, elapsed ${elapsed}`);
  }
}
assert.deepEqual(renderer.render({ ...base, timerMs: 123456.75 }), renderer.render({ ...base, timerMs: 123456 }));
const wrapNow = 0xfffffe00 + 0.25;
assert.deepEqual(renderer.render({ ...base, now: wrapNow, tareUntil: wrapNow + 400.5 }),
  renderer.render({ ...base, tareUntil: 2400 }));
assert.deepEqual(renderer.render({ ...base, now: wrapNow, shutdownUntil: wrapNow + 2900.5 }),
  renderer.render({ ...base, shutdownUntil: 4900 }));
assert.deepEqual(renderer.render({ ...base, screen: 'main', now: wrapNow,
  feedback: { text: 'Timer Top', text2: 'ON', until: wrapNow + 1000.5 } }),
  renderer.render({ ...base, screen: 'main', feedback: { text: 'Timer Top', text2: 'ON', until: 3000 } }));
for (const now of [-1, NaN, Infinity, '1600.25']) {
  assert.deepEqual(renderer.render({ ...base, now,
    prompt: { visible: true, startedAt: 0, text: 'Carpano Antica Sweet Vermouth: 31g' } }), promptAt(0));
}
assert.throws(() => renderer.render({ text: 'x'.repeat(16385) }), RangeError);
console.log(`Native/WASM parity passed for ${fixtures.length} frames across firmware screens, weights, timing, icons, feedback, and both rotations`);
console.log(`USB charging-icon correction passed for ${batteryCases.length * 2} SOC/blink/rotation cases; ${unchangedMenus.length * 2} menu frames unchanged`);
