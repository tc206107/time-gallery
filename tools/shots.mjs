// shots.mjs — 产出交付用截图（桌面 + 移动端），从已构建的 dist 抓取。
// 用法：node tools/shots.mjs <baseUrl> <outDir>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseUrl = process.argv[2] || 'http://127.0.0.1:8901/time-gallery/';
const outDir = process.argv[3] || '.shots';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});

async function shoot(name, viewport, steps) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(`${baseUrl}?smoke=1`, { waitUntil: 'networkidle0', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  await steps(page);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`saved ${outDir}/${name}.png`);
  await page.close();
}

const desktop = { width: 1440, height: 900, deviceScaleFactor: 1 };
const mobile = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// 桌面：欢迎页
await shoot('desktop-1-welcome', desktop, async () => {});

// 桌面：时间轴
await shoot('desktop-2-timeline', desktop, async (page) => {
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
});

// 桌面：展厅
await shoot('desktop-3-gallery', desktop, async (page) => {
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.click('.timeline-node .node-main');
  await page.waitForSelector('.gallery-root canvas', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 4000));
});

// 桌面：画作详情
await shoot('desktop-4-detail', desktop, async (page) => {
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.click('.timeline-node .node-main');
  await page.waitForSelector('.gallery-root canvas', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3500));
  await page.evaluate(() => window.__timeGallery.openArtwork('h01'));
  await new Promise((r) => setTimeout(r, 1200));
});

// 移动：时间轴
await shoot('mobile-1-timeline', mobile, async (page) => {
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
});

// 移动：展厅（含摇杆）
await shoot('mobile-2-gallery', mobile, async (page) => {
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.click('.timeline-node .node-main');
  await page.waitForSelector('.gallery-root canvas', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 4000));
});

// 移动：轻点开详情（真实触摸）
await shoot('mobile-3-detail', mobile, async (page) => {
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.click('.timeline-node .node-main');
  await page.waitForSelector('.gallery-root canvas', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3500));
  const box = await page.$eval('.gallery-root canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  // 只在"当前展厅内"的画作里找目标：进入的是时间轴第一个节点（古代与中世纪），
  // 因此候选必须是该时期的 id，否则 aimAtArtwork 找不到 mesh 而返回 false。
  const candidates = await page.evaluate(() => {
    const g = window.__timeGallery;
    return (g.getArtworkTransforms?.() || []).map((a) => a.id);
  });
  for (const id of candidates) {
    await page.evaluate((a) => window.__timeGallery.aimAtArtwork(a), id);
    await new Promise((r) => setTimeout(r, 400));
    await page.touchscreen.tap(Math.round(box.x), Math.round(box.y));
    await new Promise((r) => setTimeout(r, 700));
    const open = await page.evaluate(() => !!document.querySelector('.detail-overlay.is-active'));
    if (open) {
      console.log(`  mobile detail opened via tap on ${id}`);
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 800));
});

await browser.close();
console.log('done');
