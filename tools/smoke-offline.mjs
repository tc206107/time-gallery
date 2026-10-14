// _offline-i18n.mjs — 离线单文件/离线目录的双语验收（file:// 与 http 两种打开方式）
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CJK = /[\u4e00-\u9fff]/;
const target = process.argv[2];
const mobile = process.argv[3] === 'mobile';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const b = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
const p = await b.newPage();
const errs = [];
const bad = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
p.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(-40)}`); });
p.on('requestfailed', (r) => bad.push(`FAILED ${r.url().slice(-40)}`));

await p.setViewport(
  mobile
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: 1440, height: 900, deviceScaleFactor: 1 },
);
// 必须带上 smoke=1：'可打开画作详情' 依赖 window.__timeGallery 的
// getArtworkTransforms / aimAtArtwork 调试接缝，而该接缝只在 smoke 模式下挂载。
// 原来直接 goto(target)，ids 恒为空数组，点画循环一次都不执行，该项永远假性失败
// （实测把同一个页面换成带 ?smoke=1 的 URL，详情即可正常打开）。
const smokeTarget = `${target}${target.includes('?') ? '&' : '?'}smoke=1`;
await p.goto(smokeTarget, { waitUntil: 'load', timeout: 120000 });
await new Promise((r) => setTimeout(r, 1800));

// 静态模板（JS 执行前）就是英文
check('静态 lang 属性为 en', (await p.evaluate(() => document.documentElement.lang)) === 'en');
const boot = await p.evaluate(() => ({ lang: document.documentElement.lang, title: document.title }));
check('首屏 lang=en 且标题为英文', boot.lang === 'en' && boot.title === 'Time Gallery', `${boot.lang} / ${boot.title}`);

const welcomeEn = await p.$eval('.welcome-screen', (el) => (el.innerText || '').trim());
check('欢迎页默认英文且无汉字', !CJK.test(welcomeEn), welcomeEn.split('\n')[0]);

// 时间轴英文
await p.click('.welcome-start');
await p.waitForSelector('.timeline-screen.is-active', { timeout: 40000 });
await p.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 40000 });
check('时间轴 12 节点', (await p.$$eval('.timeline-node', (e) => e.length)) === 12);
const tlEn = await p.$eval('.timeline-screen', (el) => (el.innerText || '').trim());
check('时间轴英文无汉字', !CJK.test(tlEn), tlEn.split('\n')[0]);

// 进入展厅 + 详情
await p.click('.timeline-node .node-main');
await p.waitForSelector('.gallery-root canvas', { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4500));
const hudEn = await p.$eval('.gallery-hud', (el) => (el.innerText || '').trim());
check('展厅 HUD 英文无汉字', !CJK.test(hudEn), hudEn.split('\n')[0]);

const box = await p.$eval('.gallery-root canvas', (el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
const ids = await p.evaluate(() => (window.__timeGallery?.getArtworkTransforms?.() || []).map((a) => a.id));
let opened = null;
for (const id of ids) {
  await p.evaluate((a) => window.__timeGallery.aimAtArtwork(a), id);
  await new Promise((r) => setTimeout(r, 400));
  if (mobile) {
    await p.touchscreen.tap(box.x, box.y);
  } else {
    await p.mouse.click(box.x, box.y);
    await new Promise((r) => setTimeout(r, 500));
    await p.mouse.click(box.x, box.y);
  }
  await new Promise((r) => setTimeout(r, 800));
  if (await p.evaluate(() => !!document.querySelector('.detail-overlay.is-active'))) { opened = id; break; }
}
check('可打开画作详情', !!opened, String(opened));
if (opened) {
  const detEn = await p.$eval('.detail-overlay', (el) => (el.innerText || '').trim());
  check('详情英文无汉字', !CJK.test(detEn), detEn.replace(/\n+/g, ' ').slice(0, 70));
}

// 切中文（先关闭详情面板，否则遮罩会挡住切换键的点击）
await p.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 900));
const detailClosed = await p.evaluate(() => !document.querySelector('.detail-overlay.is-active'));
check('Esc 可关闭详情', detailClosed);
await p.click('.language-toggle--compact button[data-lang="zh-CN"]');
await new Promise((r) => setTimeout(r, 900));
const langZh = await p.evaluate(() => document.documentElement.lang);
check('离线包内可切到中文', langZh === 'zh-CN', langZh);
const hudZh = await p.$eval('.gallery-hud', (el) => (el.innerText || '').trim());
check('切换后展厅 HUD 变中文', CJK.test(hudZh), hudZh.split('\n')[0].slice(0, 40));

check('控制台错误 0', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
check('失败请求 0', bad.length === 0, bad.slice(0, 2).join(' | ') || 'none');

await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
failed.forEach((f) => console.log(`  FAILED ${f.name}`));
process.exit(failed.length ? 1 : 0);
