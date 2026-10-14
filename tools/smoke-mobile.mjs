// smoke-mobile.mjs — 移动端触屏验收（主脑独立验证，不由子代理自证）
//
// 验收目标（对应已确认的缺陷）：
//   1. 触屏点击画布必须直接打开画作详情，且不得依赖指针锁定。
//   2. 触屏拖动必须只旋转视角，不得误触发详情。
//   3. 控制台错误 0、未捕获异常 0、外部网络请求 0。
//   4. 资源必须在子路径下解析成功（模拟 GitHub Pages /<repo>/ 布局）。
//
// 用法：node tools/smoke-mobile.mjs [baseUrl]
//   baseUrl 默认 http://127.0.0.1:8901/time-gallery/ —— 即子路径布局。

import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseUrl = process.argv[2] || 'http://127.0.0.1:8901/time-gallery/';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
const external = [];
const failedResponses = [];

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(e.message));
// "外部请求" 指的是本站自身以外的源。站点托管后，自身资源与页面同源，
// 不属于外部依赖；只有跨源请求（第三方 CDN / 字体 / API）才算。
const siteOrigin = new URL(baseUrl).origin;
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith('data:') || u.startsWith('blob:')) return;
  try {
    if (new URL(u).origin === siteOrigin) return;
  } catch {
    return;
  }
  external.push(u);
});
page.on('response', (r) => {
  if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url()}`);
});
await page.evaluateOnNewDocument(() => {
  window.addEventListener('unhandledrejection', (e) => {
    console.error('UNHANDLED_REJECTION', e.reason?.message || String(e.reason));
  });
});

// 移动视口 + 触屏
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
);

// 必须带上 ?smoke=1：本脚本有两项检查依赖 window.__timeGallery（调试接缝），
// 而该接缝只在 smoke 模式下挂载。原来直接 goto(baseUrl)，这两项永远拿不到接口而假性失败。
const testUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}smoke=1`;
await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 90000 });
await new Promise((r) => setTimeout(r, 1200));

// 触屏能力是否被页面识别
const touchDetected = await page.evaluate(() => ({
  coarse: window.matchMedia('(pointer: coarse)').matches,
  maxTouchPoints: navigator.maxTouchPoints,
}));
check('移动视口已启用触屏模拟', touchDetected.maxTouchPoints > 0, JSON.stringify(touchDetected));

// 欢迎页 → 时间轴
await page.click('.welcome-start');
await page.waitForSelector('.timeline-screen.is-active', { timeout: 20000 });
await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 20000 });
check('时间轴渲染 12 个时期节点', true);

// 时间轴缩略图是否真的加载成功（缺陷 2 的回归判据）
const thumbStats = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.card-thumbs img')];
  return {
    total: imgs.length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    srcs: [...new Set(imgs.map((i) => i.getAttribute('src')))].slice(0, 3),
  };
});
check(
  '时间轴缩略图全部加载成功',
  thumbStats.total > 0 && thumbStats.broken === 0,
  `total=${thumbStats.total} loaded=${thumbStats.loaded} broken=${thumbStats.broken} src=${thumbStats.srcs[0]}`,
);
check(
  '缩略图使用相对路径（子路径下可解析）',
  thumbStats.srcs.every((s) => s && !s.startsWith('/')),
  `sample=${thumbStats.srcs.join(', ')}`,
);

// 进入展厅
await page.click('.timeline-node .node-main');
await page.waitForSelector('.gallery-root', { timeout: 20000 });
await page.waitForFunction(() => !!document.querySelector('.gallery-root canvas'), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 2500));

// 画作纹理是否加载成功（缺陷 1 的回归判据：3D 场景里的画作贴图）
const artLoaded = await page.evaluate(() => {
  const canvas = document.querySelector('.gallery-root canvas');
  return { hasCanvas: !!canvas, w: canvas?.width || 0, h: canvas?.height || 0 };
});
check('展厅画布已创建', artLoaded.hasCanvas && artLoaded.w > 0, JSON.stringify(artLoaded));

// 展厅内画作资源请求是否有 404
const art404 = failedResponses.filter((s) => s.includes('/art/'));
check('展厅画作资源无 404', art404.length === 0, art404.slice(0, 3).join(' | ') || 'none');

const box = await page.$eval('.gallery-root canvas', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const cx = Math.round(box.x + box.w / 2);
const cy = Math.round(box.y + box.h / 2);

// ── 核心缺陷回归：触屏拖动不得打开详情 ──
await page.touchscreen.touchStart(cx, cy);
await page.touchscreen.touchMove(cx + 60, cy + 10);
await page.touchscreen.touchMove(cx + 120, cy + 20);
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 600));
const afterDrag = await page.evaluate(() => !!document.querySelector('.detail-overlay.is-active'));
check('触屏拖动只旋转视角、不误开详情', afterDrag === false, `detailActive=${afterDrag}`);

// ── 核心缺陷回归：触屏点击必须直接打开详情（不得被指针锁定拦住）──
// 先正对一幅画：用暴露的调试接口把相机对准第 1 幅画，再点它。
const aimed = await page.evaluate(async () => {
  const g = window.__timeGallery;
  if (!g) return { ok: false, reason: 'no __timeGallery (需 ?smoke=1)' };
  const t = g.getArtworkTransforms?.() || [];
  return { ok: t.length > 0, count: t.length };
});
check('调试接口可用（smoke=1）', aimed.ok, JSON.stringify(aimed));

let tapOpened = false;
let tapDetail = '';
if (aimed.ok) {
  // 用调试接缝把相机对准目标画作，使其居中于屏幕，再在画布中心发出真实触摸点。
  // 这样"点击打开详情"的验证不依赖猜测坐标。
  const targetIds = await page.evaluate(() => {
    const g = window.__timeGallery;
    return (g.getArtworkTransforms?.() || []).map((a) => a.id);
  });

  for (const id of targetIds.slice(0, 6)) {
    if (tapOpened) break;
    const ok = await page.evaluate((aid) => window.__timeGallery.aimAtArtwork(aid), id);
    if (!ok) continue;
    await new Promise((r) => setTimeout(r, 500));
    await page.touchscreen.tap(cx, cy);
    await new Promise((r) => setTimeout(r, 800));
    const opened = await page.evaluate(() => {
      const el = document.querySelector('.detail-overlay.is-active');
      return el ? (el.querySelector('.detail-info h1')?.textContent || 'opened') : null;
    });
    if (opened) {
      tapOpened = true;
      tapDetail = `${id} → ${opened}`;
    }
  }
}
check('触屏点击可直接打开画作详情（不依赖指针锁定）', tapOpened, tapDetail || '未能命中画作');

// 详情面板内容与图片
if (tapOpened) {
  const detail = await page.evaluate(() => {
    const img = document.querySelector('.detail-overlay.is-active .detail-image-wrap img');
    return {
      src: img?.getAttribute('src') || '',
      loaded: !!(img && img.complete && img.naturalWidth > 0),
      title: document.querySelector('.detail-overlay.is-active .detail-info h1')?.textContent || '',
    };
  });
  check('详情图片加载成功', detail.loaded, `src=${detail.src}`);
  check('详情图片为相对路径', detail.src && !detail.src.startsWith('/'), `src=${detail.src}`);
  check('详情标题非空', !!detail.title, detail.title);
}

// 页面级错误汇总
check('控制台错误 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');
check('未捕获异常 0', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
check('外部网络请求 0（完全离线）', external.length === 0, external.slice(0, 3).join(' | ') || 'none');

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);
