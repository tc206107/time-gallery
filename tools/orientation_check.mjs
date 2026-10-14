import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const testUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}smoke=1`;
const rooms = [
  'ancient-medieval',
  'early-renaissance',
  'high-renaissance',
  'baroque',
  'rococo-neoclassicism',
  'romanticism',
  'realism',
  'impressionism',
  'post-impressionism',
  'modern-avant-garde',
  'expressionism-beyond',
  'american-modern',
];

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 60000 });
await page.click('.welcome-start');
await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12);

const results = [];
for (const periodId of rooms) {
  await page.click(`.timeline-node[data-id="${periodId}"] .node-main`);
  await page.waitForSelector('.gallery-root:not([hidden])', { timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const transforms = await page.evaluate(() => window.__timeGallery?.getArtworkTransforms() || []);
  const occlusion = await page.evaluate(() => window.__timeGallery?.getArtworkOcclusion() || []);
  const checks = transforms.map((item) => {
    const len = Math.hypot(item.normal.x, item.normal.y, item.normal.z);
    const nx = item.normal.x / len;
    const ny = item.normal.y / len;
    const nz = item.normal.z / len;
    const center = [0, item.position.y, 0];
    const dx = center[0] - item.position.x;
    const dy = center[1] - item.position.y;
    const dz = center[2] - item.position.z;
    const dlen = Math.hypot(dx, dy, dz) || 1;
    const dot = (nx * dx + ny * dy + nz * dz) / dlen;
    return { id: item.id, pos: item.position, normal: item.normal, dot: Number(dot.toFixed(3)) };
  });
  results.push({ periodId, checks, occlusion });
  await page.evaluate(() => document.querySelector('.gallery-back').click());
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 10000 });
}

console.log(JSON.stringify(results.map((room) => ({
  periodId: room.periodId,
  occluded: room.occlusion.filter((item) => item.occluded),
})), null, 2));
await browser.close();
