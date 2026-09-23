// Renders the link-preview image and home-screen icon from the running app.
//
//   npm run dev                  (in another terminal)
//   npm run social               (writes public/og-image.png and public/apple-touch-icon.png)
//
// Uses your installed Chrome. Set CHROME_PATH if it isn't in the default macOS location,
// and APP_URL to render from somewhere other than the local dev server.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_URL = process.env.APP_URL ?? 'http://localhost:5317/';
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});

// --- 1200×630 preview card: the painted basin on the right, the title on the left
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.goto(APP_URL, { waitUntil: 'networkidle0' });
await page.waitForSelector('#loading.done', { timeout: 60000 });
await page.addStyleTag({
  content: `
    #panel, #controls, #legend, #legend-plan, #hint, #attribution, #builders, #tooltip, #card { display: none !important; }
    #og-fade { position: fixed; inset: 0; z-index: 40; pointer-events: none;
      background: linear-gradient(90deg, #f6efe0 0%, rgba(246, 239, 224, 0.92) 28%, rgba(246, 239, 224, 0) 42%); }
    #og-title { position: fixed; left: 60px; top: 50%; transform: translateY(-50%); width: 330px; z-index: 50; }
    #og-title h1 { font-size: 76px; line-height: 0.95; }
    #og-title h1 .wash { width: 300px; height: 100px; left: -22px; top: -10px; }
    #og-title p { margin: 24px 0 0; font-family: var(--display); font-style: italic; font-weight: 500; font-size: 25px; line-height: 1.25; color: var(--ink); }
    #og-title .url { margin-top: 26px; font-family: var(--body); font-size: 17px; font-weight: 800; color: var(--ink-soft); letter-spacing: 0.02em; }
  `,
});
await page.evaluate(() => {
  const el = document.createElement('div');
  el.id = 'og-title';
  el.innerHTML = `
    <h1><span class="wash"></span>Tahoe<br><em>Trails</em></h1>
    <p>A watercolor map of the hiking &amp; mountain bike trails around Lake Tahoe</p>
    <p class="url">trails-fun.warpspire.com</p>`;
  const fade = document.createElement('div');
  fade.id = 'og-fade';
  document.body.append(fade, el);
});
await page.evaluate(() => document.fonts.ready);
// let the opening camera flight settle, then zoom in a notch and drag the basin right so it
// fills the space beside the title
await new Promise((r) => setTimeout(r, 2500));
await page.mouse.move(700, 330);
await page.mouse.wheel({ deltaY: -100 });
await new Promise((r) => setTimeout(r, 600));
await page.mouse.move(600, 560);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(600 + i * 13, 560 + i * 1, { steps: 2 });
}
await page.mouse.up();
await page.mouse.move(1199, 629); // park the cursor so no trail hover shows up
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(ROOT, 'public', 'og-image.png') });
console.log('wrote public/og-image.png');

// --- 180×180 home-screen icon, from the favicon artwork (iOS rounds the corners itself)
const svg = fs.readFileSync(path.join(ROOT, 'public', 'favicon.svg'), 'utf8').replace(/ rx="\d+"/, '');
const icon = await browser.newPage();
await icon.setViewport({ width: 180, height: 180, deviceScaleFactor: 1 });
await icon.setContent(`<style>html,body{margin:0}svg{display:block;width:180px;height:180px}</style>${svg}`);
await icon.screenshot({ path: path.join(ROOT, 'public', 'apple-touch-icon.png') });
console.log('wrote public/apple-touch-icon.png');

await browser.close();
