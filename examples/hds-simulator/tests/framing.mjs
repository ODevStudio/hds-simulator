import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, '.pio.nosync/hds-simulator-checks');
const origin = process.env.HDS_SIMULATOR_URL || 'http://localhost:18916/';
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) });
let checked = 0;

try {
  const page = await browser.newPage();
  for (const [width, height] of [[1440, 900], [1600, 720], [1440, 600], [1440, 400], [1024, 768], [640, 844], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await page.evaluate(async () => { const app = await import('./src/app.mjs'); await app.ready; app.advanceTime(1000); });
    for (const mode of ['full', 'detail']) {
      await page.locator(`#view-${mode}`).click();
      for (const clean of [false, true]) {
        if (clean) await page.locator('#clean-view').click();
        const framing = await page.evaluate(() => {
          const floor = document.querySelector('.stage-floor');
          const stage = floor.getBoundingClientRect();
          const style = getComputedStyle(floor);
          const rect = selector => { const bounds = document.querySelector(selector).getBoundingClientRect(); return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height }; };
          return { scene: rect('.scale-window'), photo: rect('.scale-photo'), content: {
            left: stage.left + parseFloat(style.paddingLeft), right: stage.right - parseFloat(style.paddingRight),
            top: stage.top + parseFloat(style.paddingTop), bottom: stage.bottom - parseFloat(style.paddingBottom),
          } };
        });
        const { scene, photo, content } = framing;
        const label = `${width}x${height} ${mode} ${clean ? 'clean' : 'normal'}: ${JSON.stringify(framing)}`;
        assert(scene.width > 0 && scene.height > 0, `Nonblank scene: ${label}`);
        assert(scene.left >= content.left - 1 && scene.right <= content.right + 1 && scene.top >= content.top - 1 && scene.bottom <= content.bottom + 1, `Scene fits available space: ${label}`);
        if (mode === 'full') {
          assert(photo.top >= scene.top - 1 && photo.bottom <= scene.bottom + 1, `Whole scale photograph is visible: ${label}`);
          assert(Math.abs(photo.width / photo.height - 2362 / 1249) < 0.001, `Photo proportions preserved: ${label}`);
        }
        await page.screenshot({ path: path.join(output, `framing-${width}-${height}-${mode}-${clean ? 'clean' : 'normal'}.png`) });
        checked++;
        if (clean) await page.keyboard.press('Escape');
      }
    }
  }
  console.log(`HDS photo framing checks passed: ${checked} desktop/mobile/short-height views`);
} finally {
  await browser.close();
}
