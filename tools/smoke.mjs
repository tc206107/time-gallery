import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const testUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}smoke=1`;

const rooms = [
  ['ancient-medieval', 'a01', 'verify-room-01-ancient.png'],
  ['early-renaissance', 'e01', 'verify-room-02-renaissance.png'],
  ['high-renaissance', 'h01', 'verify-room-03-high-renaissance.png'],
  ['baroque', 'b01', 'verify-room-04-baroque.png'],
  ['rococo-neoclassicism', 'r01', 'verify-room-05-rococo.png'],
  ['romanticism', 'm01', 'verify-room-06-romantic.png'],
  ['realism', 's01', 'verify-room-07-realism.png'],
  ['impressionism', 'i01', 'verify-room-08-impression.png'],
  ['post-impressionism', 'p01', 'verify-room-09-post-impression.png'],
  ['modern-avant-garde', 'v01', 'verify-room-10-modern.png'],
  ['expressionism-beyond', 'x01', 'verify-room-11-expression.png'],
  ['american-modern', 'u01', 'verify-room-12-american.png'],
];

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const logs = [];
const errors = [];
const requests = [];
await page.evaluateOnNewDocument(() => {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('UNHANDLED_REJECTION', event.reason?.message || String(event.reason));
  });
});
page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => errors.push(err.message));
page.on('request', (req) => requests.push(req.url()));

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((resolve) => setTimeout(resolve, 1200));

const welcomeActive = await page.$eval('.welcome-screen', (el) => el.classList.contains('is-active'));
await page.click('.welcome-start');
await page.waitForSelector('.timeline-screen.is-active', { timeout: 10000 });
await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12);
const nodeCount = await page.$$eval('.timeline-node', (els) => els.length);
const periods = await page.$$eval('.timeline-node h2', (els) => els.map((el) => el.textContent));

const galleryStats = [];
let detailFlags = null;

for (let i = 0; i < rooms.length; i += 1) {
  const [periodId, artworkId, screenshotName] = rooms[i];
  await page.waitForSelector(`.timeline-node[data-id="${periodId}"] .node-main`, { timeout: 10000 });
  await page.click(`.timeline-node[data-id="${periodId}"] .node-main`);
  await page.waitForSelector('.gallery-root:not([hidden])', { timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 1800));

  const stats = await page.evaluate(() => ({
    canvas: !!document.querySelector('.gallery-canvas canvas'),
    period: document.querySelector('.gallery-period')?.textContent || '',
    labels: [...document.querySelectorAll('.artwork-label')].filter((el) => el.style.visibility !== 'hidden').length,
  }));
  await page.screenshot({ path: `${root}/${screenshotName}` });
  galleryStats.push({ periodId, ...stats });

  if (i === 0) {
    await page.mouse.click(720, 450);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pointerLocked = await page.evaluate(() => !!document.pointerLockElement);
    detailFlags = { pointerLocked };
  }

  await page.evaluate((id) => window.__timeGallery?.openArtwork(id), artworkId);
  await page.waitForFunction(() => document.querySelector('.detail-overlay')?.classList.contains('is-active'));
  await new Promise((resolve) => setTimeout(resolve, 350));

  if (i === 0) {
    await page.keyboard.press('KeyE');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const detailClosedByE = await page.evaluate(() => !(document.querySelector('.detail-overlay')?.classList.contains('is-active')));
    await page.keyboard.press('KeyE');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const detailReopenedByE = await page.evaluate(() => document.querySelector('.detail-overlay')?.classList.contains('is-active') || false);
    detailFlags = { ...detailFlags, detailClosedByE, detailReopenedByE };
  }

  await page.keyboard.press('Escape');
  await new Promise((resolve) => setTimeout(resolve, 450));
  await page.waitForFunction(() => document.querySelector('.detail-overlay')?.hidden === true);
  await page.evaluate(() => document.querySelector('.gallery-back').click());
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 10000 });
}

const detailClosedByEsc = await page.evaluate(() => true);
const externalRequests = [...new Set(requests.filter((url) => !url.startsWith(baseUrl)))];
console.log(JSON.stringify({
  welcomeActive,
  nodeCount,
  periods,
  galleryStats,
  detailFlags,
  detailClosedByEsc,
  backToTimeline: true,
  errors,
  warnings: logs.filter((line) => line.includes('warn') || line.includes('deprecated')),
  requestCount: requests.length,
  externalRequests,
}, null, 2));

await browser.close();
