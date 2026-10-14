// 验收用截图（本任务临时产物）：一次会话内遍历若干展厅，每厅拍「入口视角」与「转 100° 视角」两张。
// 复用同一个页面（每个房间新开一页会在第 4 个房间左右耗尽 swiftshader 的软件 GL 上下文）。
// 运行：node tools/_shots.mjs                     全部 12 展厅
//       node tools/_shots.mjs early-renaissance,...  指定展厅
// 轮换命名：_audit-out/<period>-1-entrance.png / <period>-2-angle.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const dist = path.join(root, 'dist');
const outDir = path.join(root, '_audit-out');
fs.mkdirSync(outDir, { recursive: true });
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ALL = [
  'ancient-medieval', 'early-renaissance', 'high-renaissance', 'baroque',
  'rococo-neoclassicism', 'romanticism', 'realism', 'impressionism',
  'post-impressionism', 'modern-avant-garde', 'expressionism-beyond', 'american-modern',
];
const periods = process.argv[2] ? process.argv[2].split(',') : ALL;

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(`${baseUrl}?smoke=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!document.querySelector('.welcome-start'), { timeout: 30000 });
await page.evaluate(() => window.__timeGallery.setLang('en'));
await page.click('.welcome-start');
await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 30000 });

const shots = [];
for (const periodId of periods) {
  try {
    await page.click(`.timeline-node[data-id="${periodId}"] .node-main`);
    await page.waitForFunction(() => !!document.querySelector('.gallery-canvas canvas'), { timeout: 60000 });
    // 等本期 8 幅画的原图贴图到位（本地不限速，约 1–3 秒），拍到的才是最终画面
    await page.waitForFunction(() => {
      const engine = window.__timeGalleryEngine;
      if (!engine || !engine.canvasMeshes.length) return false;
      return engine.canvasMeshes.every((m) => m.material.map && m.material.map.image instanceof HTMLImageElement && m.material.map.image.src.includes('/art/'));
    }, { timeout: 120000, polling: 200 }).catch(() => {});
    await sleep(700);
    const entrance = path.join(outDir, `${periodId}-1-entrance.png`);
    await page.screenshot({ path: entrance });
    const angle = path.join(outDir, `${periodId}-2-angle.png`);
    await page.evaluate(() => {
      const engine = window.__timeGalleryEngine;
      const THREE = window.__THREE;
      const start = engine.room.cameraStart.clone();
      const look = engine.room.cameraLookAt.clone();
      const offset = start.clone().sub(look);
      const a = (100 * Math.PI) / 180;
      const rotated = new THREE.Vector3(
        offset.x * Math.cos(a) - offset.z * Math.sin(a),
        offset.y,
        offset.x * Math.sin(a) + offset.z * Math.cos(a),
      ).add(look);
      engine.controls.setInitial(rotated, look);
      engine.tick();
    });
    await sleep(500);
    await page.screenshot({ path: angle });
    shots.push({ periodId, entrance: path.basename(entrance), angle: path.basename(angle) });
    console.log(`shot ${periodId}`);
    await page.click('.gallery-back');
    await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 30000 });
    await sleep(200);
  } catch (error) {
    console.log(`ERROR ${periodId}: ${String(error).split('\n')[0]}`);
    try {
      await page.goto(`${baseUrl}?smoke=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => !!document.querySelector('.welcome-start'), { timeout: 30000 });
      await page.evaluate(() => window.__timeGallery.setLang('en'));
      await page.click('.welcome-start');
      await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 30000 });
    } catch { /* 页面不可用 */ }
  }
}
fs.writeFileSync(path.join(outDir, 'shots.json'), JSON.stringify(shots, null, 2));
console.log(`\n${shots.length}/${periods.length} rooms shot -> _audit-out/`);
await browser.close();
server.close();
