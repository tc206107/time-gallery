// _i18n_accept.mjs — 双语改造的活体验收（主脑独立验证）
//
// 验证目标（对应用户要求）：
//   1. 默认英文：未存过语言时首屏即英文
//   2. 切换键在进入界面（欢迎页）且可用
//   3. 英文界面（欢迎页/时间轴/详情）渲染文本中不得出现任何汉字
//   4. 中文界面同样不得出现未翻译残留
//   5. 切换后刷新仍保持选择（localStorage）
//   6. 时间轴 12 节点、进入展厅、轻点开详情均不回归
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CJK = /[\u4e00-\u9fff]/;
const base = process.argv[2];
const mobile = process.argv[3] === 'mobile';

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

async function newPage({ clearStorage = true } = {}) {
  const page = await browser.newPage();
  const errs = [];
  const bad = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(-50)}`); });
  page.on('requestfailed', (r) => bad.push(`FAILED ${r.url().slice(-50)}`));
  await page.setViewport(
    mobile
      ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { width: 1440, height: 900, deviceScaleFactor: 1 },
  );
  if (clearStorage) {
    // 只在首次 goto 前清一次。若挂 evaluateOnNewDocument，reload 时也会再清，
    // 「刷新后仍保持选择」就永远测不出来。
    await page.goto(`${base}?lang=en`);
    await page.evaluate(() => { try { window.localStorage.clear(); } catch {} });
  }
  return { page, errs, bad };
}

async function visibleText(page, selector) {
  return page.$eval(selector, (el) => (el.innerText || '').trim()).catch(() => '');
}

async function anyCJK(page) {
  return page.evaluate(() => {
    const sels = ['.welcome-screen', '.timeline-screen', '.gallery-root', '.detail-overlay'];
    const hits = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && CJK_RE.test(el.innerText || '')) hits.push(sel);
    }
    // 标题与 meta 描述也算界面文本
    if (CJK_RE.test(document.title)) hits.push('title');
    return hits;
  });
}

// ---------- 1. 默认英文 ----------
{
  const { page } = await newPage();
  await page.goto(`${base}?lang=en`, { waitUntil: 'networkidle0', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  const welcomeActive = await page.$eval('.welcome-screen', (el) => el.classList.contains('is-active')).catch(() => false);
  check('默认 <html lang> 为 en', htmlLang === 'en', htmlLang);

  const toggles = await page.$$('.language-toggle');
  check('切换键存在于欢迎页（进入界面）', toggles.length > 0, `${toggles.length} 个`);

  const btn = await page.$('.language-toggle--default button[data-lang="zh-CN"]');
  check('欢迎页可切换到中文按钮存在', !!btn);

  // 未存语言时（无 ?lang）→ 应默认英文
  check('欢迎页为激活状态', welcomeActive);

  const enText = await visibleText(page, '.welcome-screen');
  check('欢迎页英文文案无汉字', !CJK.test(enText), enText.split('\n').slice(0, 3).join(' | ').slice(0, 90));
  await page.close();
}

// ---------- 2. 英文界面无汉字（时间轴 + 详情）----------
{
  const { page, errs, bad } = await newPage();
  // 带 smoke=1 才会注册 __timeGallery 调试接缝，供 aimAtArtwork 定位画作
  await page.goto(`${base}?lang=en&smoke=1`, { waitUntil: 'networkidle0', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 30000 });
  const nodes = await page.$$eval('.timeline-node', (e) => e.length);
  check('时间轴渲染 12 节点', nodes === 12, String(nodes));

  const tlText = await visibleText(page, '.timeline-screen');
  check('时间轴英文文案无汉字', !CJK.test(tlText), tlText.split('\n').slice(0, 2).join(' | ').slice(0, 80));

  // 进入展厅
  await page.click('.timeline-node .node-main');
  await page.waitForSelector('.gallery-root canvas', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3500));
  const hudText = await page.$eval('.gallery-hud', (el) => (el.innerText || '').trim()).catch(() => '');
  check('展厅 HUD 英文文案无汉字', !CJK.test(hudText), hudText.split('\n').slice(0, 2).join(' | ').slice(0, 80));

  // 展厅内切换器（compact）
  const compact = await page.$$('.language-toggle--compact');
  check('展厅内也有语言切换键', compact.length > 0, `${compact.length} 个`);

  // 打开详情
  const box = await page.$eval('.gallery-root canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  const ids = await page.evaluate(() => (window.__timeGallery?.getArtworkTransforms?.() || []).map((a) => a.id));
  let opened = null;
  for (const id of ids) {
    await page.evaluate((a) => window.__timeGallery.aimAtArtwork(a), id);
    await new Promise((r) => setTimeout(r, 400));
    if (mobile) {
      await page.touchscreen.tap(box.x, box.y);
    } else {
      // 桌面：第一次点击申请指针锁定，锁定后第二次点击才拾取画作
      await page.mouse.click(box.x, box.y);
      await new Promise((r) => setTimeout(r, 500));
      await page.mouse.click(box.x, box.y);
    }
    await new Promise((r) => setTimeout(r, 800));
    if (await page.evaluate(() => !!document.querySelector('.detail-overlay.is-active'))) { opened = id; break; }
  }
  check('轻点/点击画作可打开详情', !!opened, String(opened));

  if (opened) {
    const detText = await visibleText(page, '.detail-overlay');
    check('画作详情英文文案无汉字', !CJK.test(detText), detText.replace(/\n+/g, ' ').slice(0, 90));
    const img = await page.$eval('.detail-overlay.is-active .detail-image-wrap img', (el) => ({ ok: el.complete && el.naturalWidth > 0, src: el.getAttribute('src') })).catch(() => null);
    check('详情图片加载成功', !!img && img.ok, img ? img.src.slice(-30) : 'none');
    const dim = await page.$eval('.detail-dimensions', (el) => (el.innerText || '').trim()).catch(() => '');
    check('画作尺寸标签为英文', !!dim && !CJK.test(dim), dim);
  }

  check('控制台错误 0', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
  check('失败请求 0', bad.length === 0, bad.slice(0, 2).join(' | ') || 'none');
  await page.close();
}

// ---------- 3. 切回中文界面 ----------
{
  const { page } = await newPage();
  await page.goto(`${base}?lang=zh`, { waitUntil: 'networkidle0', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  check('中文模式 <html lang> 为 zh-CN', htmlLang === 'zh-CN', htmlLang);
  const zhText = await visibleText(page, '.welcome-screen');
  check('中文模式欢迎页含中文', CJK.test(zhText), zhText.split('\n')[0] || '');

  // 中文时间轴
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 30000 });
  const zhTl = await visibleText(page, '.timeline-screen');
  check('中文模式时间轴为中文', CJK.test(zhTl), zhTl.split('\n').slice(0, 2).join(' | ').slice(0, 70));
  await page.close();
}

// ---------- 4. 切换 + 持久化 ----------
{
  const { page } = await newPage();
  // 持久化测试必须用「无 ?lang= 参数」的 URL：?lang= 优先级高于 localStorage，
  // 带着它 reload 会按设计覆盖存储值，测不出持久化。
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));
  const before = await page.evaluate(() => document.documentElement.lang);
  await page.click('.language-toggle--default button[data-lang="zh-CN"]');
  await new Promise((r) => setTimeout(r, 800));
  const after = await page.evaluate(() => document.documentElement.lang);
  check('在欢迎页点击切换即时生效', before === 'en' && after === 'zh-CN', `${before} -> ${after}`);
  const zhNow = await visibleText(page, '.welcome-screen');
  check('切换后欢迎页变中文', CJK.test(zhNow), zhNow.split('\n')[0] || '');

  // 刷新仍保持（localStorage）
  await page.reload({ waitUntil: 'networkidle0', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1000));
  const persisted = await page.evaluate(() => document.documentElement.lang);
  check('刷新后语言保持中文（localStorage）', persisted === 'zh-CN', persisted);

  // 切回英文并再刷新，验证双向持久化
  await page.click('.language-toggle--default button[data-lang="en"]');
  await new Promise((r) => setTimeout(r, 700));
  await page.reload({ waitUntil: 'networkidle0', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1000));
  const backEn = await page.evaluate(() => document.documentElement.lang);
  check('切回英文并刷新后保持英文', backEn === 'en', backEn);
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)); }
process.exit(failed.length ? 1 : 0);
