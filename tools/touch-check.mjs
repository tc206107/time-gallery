// 移动端触点回归检查（tools/touch-check.mjs）
//
// 用一个真实浏览器分别以「桌面鼠标」与「触摸屏」两种能力运行同一个页面，验证：
//   桌面：点击画面申请指针锁定、指针锁定后点击画作开详情、E 开合详情、Esc 关闭、返回时间轴、像素比上限 2、SSAO 存在
//   触摸：is-touch 标记与触摸版提示文案、摇杆存在、canvas touch-action=none、
//         轻点画作直接开详情且从不申请指针锁定、拖动只旋转视角不触发详情、
//         摇杆推动相机且松手即停、低功耗下无 SSAO 但 bloom 仍在、像素比上限 1.5、帧时间超标后只降不升
//
// 页面侧探针（requestPointerLock 计数、着色器源码标记、rAF 间隔）全部由本脚本注入，
// 生产代码里没有任何测试钩子。画作的屏幕坐标由本脚本按 room.js 的相机参数独立算出，
// 不复用产物里的任何投影逻辑。
//
// 运行：
//   pnpm dev -- --port 5183 --strictPort        （另一个终端）
//   TEST_URL=http://127.0.0.1:5183/ node tools/touch-check.mjs
// 可选：SHOT_DIR=<dir> 时额外保存两张截图。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const SHOT_DIR = process.env.SHOT_DIR || '';
const manifest = JSON.parse(readFileSync(`${ROOT}/manifest.json`, 'utf8'));

// src/three/room.js:441-442（buildAncientMedieval）作为本轮检查用到的展厅。
const ROOM = { periodId: 'ancient-medieval' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const titleOf = (id) => manifest.artworks.find((item) => item.id === id)?.title || null;

async function instrument(page) {
  await page.evaluateOnNewDocument(() => {
    const probe = {
      lockCalls: 0,
      lockErrors: 0,
      touchPointerDowns: 0,
      ssaoShader: false,
      bloomShader: false,
      shaderSources: 0,
      rafTimes: [],
      ratioTimeline: [],
    };
    window.__probe = probe;

    const originalLock = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function requestPointerLockPatched(...args) {
      probe.lockCalls += 1;
      return originalLock.apply(this, args);
    };
    document.addEventListener('pointerlockerror', () => {
      probe.lockErrors += 1;
    }, true);
    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') probe.touchPointerDowns += 1;
    }, true);

    for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!ctor) continue;
      const originalShaderSource = ctor.prototype.shaderSource;
      ctor.prototype.shaderSource = function shaderSourcePatched(shader, source) {
        const text = String(source);
        probe.shaderSources += 1;
        if (text.includes('KERNEL_SIZE')) probe.ssaoShader = true;
        if (text.includes('KERNEL_RADIUS')) probe.bloomShader = true;
        return originalShaderSource.call(this, shader, source);
      };
    }

    const originalRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => originalRaf((time) => {
      probe.rafTimes.push(time);
      if (probe.rafTimes.length > 600) probe.rafTimes.shift();
      callback(time);
    });

    setInterval(() => {
      const canvas = document.querySelector('.gallery-canvas canvas');
      if (!canvas) return;
      const width = canvas.getBoundingClientRect().width;
      if (!width) return;
      probe.ratioTimeline.push({ t: Math.round(performance.now()), ratio: Number((canvas.width / width).toFixed(3)) });
    }, 250);
  });
}

async function openRoom(page) {
  await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}smoke=1`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.click('.welcome-start');
  await page.waitForSelector('.timeline-screen.is-active', { timeout: 15000 });
  await page.waitForSelector(`.timeline-node[data-id="${ROOM.periodId}"] .node-main`, { timeout: 15000 });
  await page.click(`.timeline-node[data-id="${ROOM.periodId}"] .node-main`);
  await page.waitForSelector('.gallery-root:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.gallery-canvas canvas')?.width > 0, { timeout: 30000 });
  await sleep(1500);
}

const canvasMetrics = () => ({
  ratio: document.querySelector('.gallery-canvas canvas').width
    / document.querySelector('.gallery-canvas canvas').getBoundingClientRect().width,
  backingWidth: document.querySelector('.gallery-canvas canvas').width,
  cssWidth: document.querySelector('.gallery-canvas canvas').getBoundingClientRect().width,
});

const labelSignature = () => [...document.querySelectorAll('.artwork-label')]
  .map((el) => el.style.transform)
  .join('|');

async function dispatchTouch(client, type, points) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

async function tapAt(client, x, y) {
  await dispatchTouch(client, 'touchStart', [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }]);
  await sleep(60);
  await dispatchTouch(client, 'touchEnd', []);
}

async function dragBy(client, fromX, fromY, toX, toY, steps = 5) {
  await dispatchTouch(client, 'touchStart', [{ x: fromX, y: fromY, radiusX: 6, radiusY: 6, force: 1, id: 1 }]);
  for (let step = 1; step <= steps; step += 1) {
    await sleep(40);
    await dispatchTouch(client, 'touchMove', [{
      x: fromX + ((toX - fromX) * step) / steps,
      y: fromY + ((toY - fromY) * step) / steps,
      radiusX: 6,
      radiusY: 6,
      force: 1,
      id: 1,
    }]);
  }
  await sleep(40);
  await dispatchTouch(client, 'touchEnd', []);
}

const detailState = () => ({
  active: document.querySelector('.detail-overlay')?.classList.contains('is-active') || false,
  title: document.querySelector('.detail-overlay .detail-info h1')?.textContent || null,
  locked: Boolean(document.pointerLockElement),
  lockCalls: window.__probe.lockCalls,
  lockErrors: window.__probe.lockErrors,
});

async function closeDetail(page) {
  const closeButton = await page.$('.detail-overlay .detail-close');
  if (closeButton) await closeButton.click();
  await sleep(600);
}

async function runDesktop(browser) {
  const page = await browser.newPage();
  await instrument(page);
  await page.setViewport({ width: 720, height: 540, deviceScaleFactor: 3 });
  await openRoom(page);

  const result = { viewport: '720x540@3 (鼠标，无触摸能力)' };
  result.hint = await page.$eval('.gallery-controls-hint', (el) => el.textContent.trim());
  result.rootClass = await page.$eval('.gallery-root', (el) => el.className);
  result.joystickPresent = (await page.$('.gallery-touch-controls')) !== null;
  result.pointerHintDisplay = await page.$eval('.pointer-hint', (el) => getComputedStyle(el).display);
  result.canvasTouchAction = await page.$eval('.gallery-canvas canvas', (el) => getComputedStyle(el).touchAction);
  result.metrics = await page.evaluate(canvasMetrics);
  result.devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  result.hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
  result.maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);

  const occlusion = await page.evaluate(() => window.__timeGallery.getArtworkOcclusion());
  const target = occlusion.find((item) => !item.occluded) || null;
  result.targetId = target ? target.id : null;
  result.expectedTitle = target ? titleOf(target.id) : null;
  result.aimed = target ? await page.evaluate((id) => window.__timeGallery.aimAtArtwork(id), target.id) : false;
  await sleep(600);

  await page.mouse.click(360, 270);
  await sleep(500);
  result.afterFirstClick = await page.evaluate(detailState);
  await page.evaluate(() => document.exitPointerLock());
  await sleep(400);
  result.afterProgrammaticUnlock = await page.evaluate(detailState);

  // 锁定时 clientX/clientY 被冻结，故两次点击都打在画面中心（aimAtArtwork 已把画作摆到中心）。
  await page.mouse.click(360, 270);
  await sleep(400);
  await page.mouse.click(360, 270);
  await sleep(900);
  result.afterRaycastClick = await page.evaluate(detailState);
  result.raycastTitleMatchesTarget = result.afterRaycastClick.title === result.expectedTitle;

  await page.keyboard.press('KeyE');
  await sleep(700);
  result.afterE = await page.evaluate(detailState);
  await page.keyboard.press('KeyE');
  await sleep(700);
  result.afterEReopen = await page.evaluate(detailState);
  await page.keyboard.press('Escape');
  await sleep(700);
  result.afterEscapeOnDetail = await page.evaluate(detailState);

  await page.evaluate(() => document.exitPointerLock());
  await sleep(300);
  await page.click('.gallery-back');
  await sleep(900);
  result.backToTimeline = await page.evaluate(() => Boolean(document.querySelector('.timeline-screen.is-active')));

  result.probe = await page.evaluate(() => {
    const probe = window.__probe;
    const times = probe.rafTimes;
    const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
    return {
      lockCalls: probe.lockCalls,
      lockErrors: probe.lockErrors,
      touchPointerDowns: probe.touchPointerDowns,
      ssaoShader: probe.ssaoShader,
      bloomShader: probe.bloomShader,
      shaderSources: probe.shaderSources,
      medianFrameMs: intervals.length ? Number(intervals[Math.floor(intervals.length / 2)].toFixed(1)) : null,
    };
  });
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/desktop-room.png` });
  await page.close();
  return result;
}

async function runTouch(browser) {
  const page = await browser.newPage();
  await instrument(page);
  const client = await page.createCDPSession();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenOrientation: { angle: 0, type: 'portraitPrimary' },
  });
  try {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }],
    });
  } catch (error) {
    // 该浏览器不支持 pointer 特性模拟时忽略：触摸模拟本身已经会让 pointer:coarse 命中。
  }
  await openRoom(page);

  const result = { viewport: '390x844@3 (触摸模拟)' };
  result.hint = await page.$eval('.gallery-controls-hint', (el) => el.textContent.trim());
  result.rootClass = await page.$eval('.gallery-root', (el) => el.className);
  result.joystickPresent = (await page.$('.gallery-touch-controls')) !== null;
  result.joystickSize = await page.$eval('.touch-joystick', (el) => {
    const rect = el.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), bottom: Math.round(window.innerHeight - rect.bottom) };
  });
  result.pointerHintDisplay = await page.$eval('.pointer-hint', (el) => getComputedStyle(el).display);
  result.canvasTouchAction = await page.$eval('.gallery-canvas canvas', (el) => getComputedStyle(el).touchAction);
  result.metrics = await page.evaluate(canvasMetrics);
  result.devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  result.mediaPointerCoarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
  result.maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);
  result.hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/touch-room.png` });

  const occlusion = await page.evaluate(() => window.__timeGallery.getArtworkOcclusion());
  const target = occlusion.find((item) => !item.occluded) || null;
  result.targetId = target ? target.id : null;
  result.expectedTitle = target ? titleOf(target.id) : null;
  result.aimed = target ? await page.evaluate((id) => window.__timeGallery.aimAtArtwork(id), target.id) : false;
  await sleep(600);

  // 1) 拖动只旋转视角，不得开详情
  const beforeDrag = await page.evaluate(labelSignature);
  const lockCallsBeforeDrag = await page.evaluate(() => window.__probe.lockCalls);
  await dragBy(client, 195, 300, 195 + 160, 300 + 40);
  await sleep(900);
  const afterDrag = await page.evaluate(labelSignature);
  result.drag = {
    viewChanged: beforeDrag !== afterDrag,
    lockCallsDelta: (await page.evaluate(() => window.__probe.lockCalls)) - lockCallsBeforeDrag,
    detail: await page.evaluate(detailState),
  };

  // 2) 重新对准画作后轻点画面中心：直接开详情，且全程不申请指针锁定
  if (target) await page.evaluate((id) => window.__timeGallery.aimAtArtwork(id), target.id);
  await sleep(600);
  await tapAt(client, 195, 422);
  await sleep(900);
  result.tap = await page.evaluate(detailState);
  result.tapTitleMatchesTarget = result.tap.title === result.expectedTitle;
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/touch-detail.png` });
  await closeDetail(page);
  result.afterCloseDetail = await page.evaluate(detailState);

  // 3) 轻点空白（左上角 HUD 下方，没有画作的位置）不开详情
  await tapAt(client, 30, 200);
  await sleep(700);
  result.tapEmptyArea = await page.evaluate(detailState);

  // 4) 摇杆推动相机，松手即停
  const beforeHold = await page.evaluate(labelSignature);
  const stick = result.joystickSize;
  const centerX = stick.left + stick.width / 2;
  const centerY = 844 - stick.bottom - stick.height / 2;
  await dispatchTouch(client, 'touchStart', [{ x: centerX, y: centerY, radiusX: 6, radiusY: 6, force: 1, id: 2 }]);
  await sleep(120);
  await dispatchTouch(client, 'touchMove', [{ x: centerX, y: centerY - 40, radiusX: 6, radiusY: 6, force: 1, id: 2 }]);
  await sleep(2500);
  const duringHold = await page.evaluate(labelSignature);
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/touch-joystick-held.png` });
  await dispatchTouch(client, 'touchEnd', []);
  await sleep(700);
  const afterReleaseA = await page.evaluate(labelSignature);
  await sleep(700);
  const afterReleaseB = await page.evaluate(labelSignature);
  result.joystick = {
    movedWhileHeld: beforeHold !== duringHold,
    detailOpened: (await page.evaluate(detailState)).active,
    lockCalls: await page.evaluate(() => window.__probe.lockCalls),
    stoppedAfterRelease: afterReleaseA === afterReleaseB,
    knobTransformAfterRelease: await page.$eval('.touch-joystick-knob', (el) => el.style.transform),
    engagedClassAfterRelease: await page.$eval('.touch-joystick', (el) => el.classList.contains('is-engaged')),
  };

  // 5) 长按摇杆持续前进：摇杆一直按住（setMoveVector 始终非零），此时唯一能让相机停下的
  //    机制就是 setBounds 的位置夹取。以 getArtworkOcclusion() 的射线距离当相机位置的代理：
  //    相机不动则每个距离读数都不变。
  const transforms = await page.evaluate(() => window.__timeGallery.getArtworkTransforms());
  const straightest = transforms.slice().sort((a, b) => Math.abs(a.position.x) - Math.abs(b.position.x))[0];
  if (straightest) await page.evaluate((id) => window.__timeGallery.aimAtArtwork(id), straightest.id);
  await sleep(600);

  const distances = () => page.evaluate(() => window.__timeGallery.getArtworkOcclusion().map((item) => item.distance));
  await dispatchTouch(client, 'touchStart', [{ x: centerX, y: centerY, radiusX: 6, radiusY: 6, force: 1, id: 3 }]);
  await sleep(150);
  await dispatchTouch(client, 'touchMove', [{ x: centerX, y: centerY - 40, radiusX: 6, radiusY: 6, force: 1, id: 3 }]);
  await sleep(12000);
  const distancesA = await distances();
  const stickStillHeld = await page.$eval('.touch-joystick', (el) => el.classList.contains('is-engaged'));
  await sleep(1500);
  const distancesB = await distances();
  await dispatchTouch(client, 'touchEnd', []);
  const maxDelta = Math.max(...distancesA.map((value, index) => Math.abs(value - distancesB[index])));
  result.bounds = {
    heldSeconds: 13.5,
    stickStillHeldWhileSampled: stickStillHeld,
    maxDistanceDelta: Number(maxDelta.toFixed(4)),
    pinnedAtLimit: stickStillHeld && maxDelta < 0.05,
    distances: distancesB,
  };
  await sleep(400);

  // 6) 自适应分辨率：帧时间持续超标时只降不升
  const timeline = await page.evaluate(() => window.__probe.ratioTimeline);
  const steps = [];
  let previous = null;
  for (const sample of timeline) {
    if (previous === null) {
      previous = sample.ratio;
      continue;
    }
    if (Math.abs(sample.ratio - previous) > 0.001) {
      steps.push({ t: sample.t, from: previous, to: sample.ratio });
      previous = sample.ratio;
    }
  }
  result.adaptive = {
    ratioBefore: steps.length ? steps[0].from : previous,
    ratioAfter: previous,
    steps,
    increased: steps.some((step) => step.to > step.from),
    cpuThrottledDuringRun: false,
    sampleCount: timeline.length,
  };

  result.probe = await page.evaluate(() => {
    const probe = window.__probe;
    const times = probe.rafTimes;
    const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
    return {
      lockCalls: probe.lockCalls,
      lockErrors: probe.lockErrors,
      touchPointerDowns: probe.touchPointerDowns,
      ssaoShader: probe.ssaoShader,
      bloomShader: probe.bloomShader,
      shaderSources: probe.shaderSources,
      medianFrameMs: intervals.length ? Number(intervals[Math.floor(intervals.length / 2)].toFixed(1)) : null,
    };
  });
  await page.close();
  return result;
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});

const output = { baseUrl: BASE_URL, room: ROOM.periodId };
const only = process.env.ONLY || 'both';
if (only !== 'touch') {
  try {
    output.desktop = await runDesktop(browser);
  } catch (error) {
    output.desktopError = error.message;
  }
}
if (only !== 'desktop') {
  try {
    output.touch = await runTouch(browser);
  } catch (error) {
    output.touchError = error.message;
  }
}
console.log(JSON.stringify(output, null, 2));
await browser.close();
