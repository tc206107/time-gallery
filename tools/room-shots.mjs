// 一次性自检脚本（_ 前缀=本任务临时产物）：给「英文标题牌互相压盖」拍真图，供视觉核对。
// 运行：node tools/_i18n-room-shots.mjs
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const jobs = [
  ['en', 'early-renaissance', '_i18n-room-02-early-renaissance-en.png'],
  ['en', 'post-impressionism', '_i18n-room-09-post-impressionism-en.png'],
  ['en', 'rococo-neoclassicism', '_i18n-room-05-rococo-en.png'],
  ['zh-CN', 'early-renaissance', '_i18n-room-02-early-renaissance-zh.png'],
];

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
const shots = [];
for (const [lang, periodId, file] of jobs) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}?smoke=1`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate((value) => window.__timeGallery.setLang(value), lang);
  await sleep(300);
  await page.click('.welcome-start');
  await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 20000 });
  await page.click(`.timeline-node[data-id="${periodId}"] .node-main`);
  await page.waitForFunction(() => !!document.querySelector('.gallery-canvas canvas'), { timeout: 40000 });
  await sleep(2200);
  await page.screenshot({ path: path.join(root, file) });
  shots.push({ lang, periodId, file });
  await page.close();
}
console.log(JSON.stringify(shots, null, 2));
await browser.close();
server.close();
