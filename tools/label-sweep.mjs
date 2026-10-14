// 一次性自检脚本（_ 前缀=本任务临时产物）：12 个展厅全扫一遍，看英文墙上标题牌是否互相压盖。
// 依据：.artwork-label 是 white-space:nowrap，英文标题最长可达中文的 1.5 倍以上。
// 运行：node tools/_i18n-label-sweep.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('nope');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;

const periods = ['ancient-medieval', 'early-renaissance', 'high-renaissance', 'baroque', 'rococo-neoclassicism', 'romanticism', 'realism', 'impressionism', 'post-impressionism', 'modern-avant-garde', 'expressionism-beyond', 'american-modern'];

const launch = () => puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
let browser = await launch();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROBE = () => {
  window.__sweep = () => {
    const labels = [...document.querySelectorAll('.artwork-label')].filter((el) => el.style.visibility !== 'hidden');
    const boxes = labels.map((el) => ({ text: el.textContent.trim().replace(/\s+/g, ' '), r: el.getBoundingClientRect() }));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i].r;
        const b = boxes[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1) overlaps.push({ a: boxes[i].text.slice(0, 30), b: boxes[j].text.slice(0, 30), overlapW: +ox.toFixed(1), overlapH: +oy.toFixed(1) });
      }
    }
    const widths = boxes.map((b) => +b.r.width.toFixed(1));
    const clipped = boxes.filter((b) => b.r.left < -1 || b.r.right > window.innerWidth + 1).map((b) => b.text.slice(0, 30));
    return {
      visible: boxes.length,
      overlaps,
      maxLabelW: widths.length ? Math.max(...widths) : 0,
      minLabelW: widths.length ? Math.min(...widths) : 0,
      offscreen: clipped,
      cjkTitles: boxes.filter((b) => /[\u4e00-\u9fff]/.test(b.text)).length,
    };
  };
};

const results = {};
for (const lang of ['en', 'zh-CN']) {
  const key = lang === 'en' ? 'en' : 'zh';
  results[key] = {};
  for (const periodId of periods) {
    // 每间展厅用一个全新页面：SwiftShader 下连续重建 12 次 WebGL 场景会把标签页拖垮。
    if (!browser.connected) browser = await launch();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(PROBE);
      await page.goto(`${baseUrl}?smoke=1`, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.evaluate((value) => window.__timeGallery.setLang(value), lang);
      await sleep(250);
      await page.click('.welcome-start');
      await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 20000 });
      await page.click(`.timeline-node[data-id="${periodId}"] .node-main`);
      await page.waitForSelector('.gallery-root:not([hidden])', { timeout: 40000 });
      await page.waitForFunction(() => !!document.querySelector('.gallery-canvas canvas'), { timeout: 40000 });
      await sleep(2000);
      results[key][periodId] = await page.evaluate(() => window.__sweep());
    } catch (error) {
      results[key][periodId] = { failed: String(error && error.message ? error.message : error).split(String.fromCharCode(10))[0] };
    }
    await page.close().catch(() => {});
  }
}
const summary = {};
for (const key of ['en', 'zh']) {
  const rooms = results[key];
  const ok = Object.entries(rooms).filter(([, room]) => !room.failed);
  const failed = Object.entries(rooms).filter(([, room]) => room.failed).map(([id, room]) => ({ id, error: room.failed }));
  summary[key] = {
    roomsMeasured: ok.length,
    roomsFailed: failed,
    totalVisibleLabels: ok.reduce((sum, [, room]) => sum + room.visible, 0),
    totalOverlaps: ok.reduce((sum, [, room]) => sum + room.overlaps.length, 0),
    roomsWithOverlap: ok.filter(([, room]) => room.overlaps.length).map(([id, room]) => ({ id, overlaps: room.overlaps })),
    maxLabelW: ok.length ? Math.max(...ok.map(([, room]) => room.maxLabelW)) : null,
    offscreenLabels: ok.filter(([, room]) => room.offscreen.length).map(([id, room]) => ({ id, offscreen: room.offscreen })),
    cjkTitlesInEnMode: key === 'en' ? ok.reduce((sum, [, room]) => sum + room.cjkTitles, 0) : null,
  };
}
fs.writeFileSync(path.join(root, '_i18n-label-sweep.json'), JSON.stringify({ summary, results }, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
await browser.close();
server.close();
process.exit(summary.en.totalOverlaps === 0 && summary.zh.totalOverlaps === 0 && summary.en.cjkTitlesInEnMode === 0 && summary.en.roomsFailed.length === 0 && summary.zh.roomsFailed.length === 0 ? 0 : 1);
