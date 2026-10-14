// 验收脚本（本任务用）：两种模式，供主控独立复验子代理产出。
//   node tools/_verify.mjs geom            全部 12 房间的几何审计（画框互相嵌合 / 悬空离墙）
//   node tools/_verify.mjs geom r1,r2      只审计指定房间
//   node tools/_verify.mjs load [period]   限速 13KB/s 下的贴图加载计时（默认 early-renaissance）
// 几何审计判据：同墙画框包围盒相交 => 嵌合；画心沿 -法线 打射线，命中房间几何距离 > 1.2 => 悬空。
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

const ALL_PERIODS = [
  'ancient-medieval', 'early-renaissance', 'high-renaissance', 'baroque',
  'rococo-neoclassicism', 'romanticism', 'realism', 'impressionism',
  'post-impressionism', 'modern-avant-garde', 'expressionism-beyond', 'american-modern',
];

const mode = process.argv[2] || 'geom';
const arg = process.argv[3];

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});

async function openApp(page, periodId) {
  await page.goto(`${baseUrl}?smoke=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('.welcome-start'), { timeout: 30000 });
  await page.evaluate(() => window.__timeGallery.setLang('en'));
  await page.click('.welcome-start');
  await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 30000 });
  if (periodId) await enterFromTimeline(page, periodId);
}

// 同一个页面里从时间线进房间：复用同一个 WebGL 上下文。
// （每个房间新开一页会在第 4 个房间左右耗尽 swiftshader 的软件 GL 上下文，
//   表现为 canvas 永远不出现——实测踩到过。）
async function enterFromTimeline(page, periodId) {
  await page.click(`.timeline-node[data-id="${periodId}"] .node-main`);
  await page.waitForFunction(() => !!document.querySelector('.gallery-canvas canvas'), { timeout: 60000 });
  await sleep(400);
}

async function backToTimeline(page) {
  await page.click('.gallery-back');
  await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 30000 });
  await sleep(150);
}

// ---- 页面内几何审计（与 tools/_audit-rooms.mjs 同一套算法） ----
const AUDIT_FN = () => {
  const engine = window.__timeGalleryEngine;
  const THREE = window.__THREE;
  if (!engine || !engine.artGroup) return { error: 'no engine' };
  const groups = [];
  engine.artGroup.children.forEach((child) => {
    if (child.userData && child.userData.artworkId) groups.push(child);
  });
  const room = engine.room;
  const frames = groups.map((group) => {
    const box = new THREE.Box3().setFromObject(group);
    const mesh = group.children.find((c) => c.name === 'artwork-canvas');
    const normal = new THREE.Vector3();
    mesh.getWorldDirection(normal);
    return {
      id: group.userData.artworkId,
      size: { w: +mesh.scale.x.toFixed(2), h: +mesh.scale.y.toFixed(2) },
      groupPosition: { x: +group.position.x.toFixed(2), y: +group.position.y.toFixed(2), z: +group.position.z.toFixed(2) },
      normal: { x: +normal.x.toFixed(2), y: +normal.y.toFixed(2), z: +normal.z.toFixed(2) },
      box,
    };
  });
  const overlaps = [];
  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      const a = frames[i].box.clone().expandByScalar(0.02);
      const b = frames[j].box.clone().expandByScalar(0.02);
      if (!a.intersectsBox(b)) continue;
      const na = frames[i].normal;
      const nb = frames[j].normal;
      const sameWall = Math.abs(na.x - nb.x) < 0.05 && Math.abs(na.y - nb.y) < 0.05 && Math.abs(na.z - nb.z) < 0.05;
      if (!sameWall) continue;
      const size = a.intersect(b).getSize(new THREE.Vector3());
      overlaps.push({ a: frames[i].id, b: frames[j].id, depth: +Math.min(size.x, size.y, size.z).toFixed(2) });
    }
  }
  const floaters = [];
  const raycaster = new THREE.Raycaster();
  const targets = [];
  room.group.traverse((obj) => {
    if (obj.isMesh) {
      targets.push(obj);
      if (obj.material && 'side' in obj.material) obj.material.side = THREE.DoubleSide;
    }
  });
  for (const frame of frames) {
    const gp = frame.groupPosition;
    const from = new THREE.Vector3(gp.x, gp.y, gp.z);
    const dir = new THREE.Vector3(-frame.normal.x, -frame.normal.y, -frame.normal.z).normalize();
    raycaster.set(from, dir);
    raycaster.far = 6;
    const hits = raycaster.intersectObjects(targets, false);
    const dist = hits.length ? hits[0].distance : null;
    if (dist === null || dist > 1.2) {
      floaters.push({ id: frame.id, wallDistance: dist === null ? null : +dist.toFixed(2), hit: hits[0] ? (hits[0].object.name || hits[0].object.type) : null });
    }
  }
  return { count: frames.length, overlaps, floaters };
};

// 可视性检查：从**当前渲染相机**位置水平打一圈射线，**不改动任何材质**（FrontSide/BackSide 原样），
// 命中的就是渲染时真正看得见的面；再在房间边界内打 5×5 网格的垂直向下射线，查地板有没有漏洞。
const SIGHT_FN = () => {
  const engine = window.__timeGalleryEngine;
  const THREE = window.__THREE;
  const raycaster = new THREE.Raycaster();
  const targets = [];
  engine.room.group.traverse((obj) => { if (obj.isMesh) targets.push(obj); });
  const eye = new THREE.Vector3();
  engine.camera.getWorldPosition(eye);
  const rows = [];
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).normalize();
    raycaster.set(eye, dir);
    raycaster.far = 60;
    const hits = raycaster.intersectObjects(targets, false);
    rows.push({ deg: Math.round((angle * 180) / Math.PI), hit: hits.length ? (hits[0].object.name || hits[0].object.type) : null });
  }
  const seen = {};
  for (const r of rows) {
    const key = r.hit === null ? 'MISS(看不见任何面)' : r.hit;
    seen[key] = (seen[key] || 0) + 1;
  }
  // 地板漏洞：边界内 5×5 网格，每个点从 y=3 垂直向下打，应命中 floor/reflective-floor。
  // 每个点打两条（第二条在 x/z 上各偏 0.013/0.017）：圆盘是按扇面三角剖分的，
  // 射线正好走在中轴（局部 Y=0）上时与扇面径向边共线，Möller–Trumbore 会同时漏掉两侧三角形
  // （实测洛可可椭圆盘 z=0 那一排整排报空）。两条都打空才算漏洞。
  const b = engine.room.bounds;
  const gaps = [];
  const down = new THREE.Vector3(0, -1, 0);
  const namesAt = (x, z) => {
    raycaster.set(new THREE.Vector3(x, 3, z), down);
    raycaster.far = 12;
    const hits = raycaster.intersectObjects(targets, false);
    return { name: hits.length ? (hits[0].object.name || hits[0].object.type) : null, dist: hits.length ? +hits[0].distance.toFixed(2) : null };
  };
  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      const x = b.minX + ((i + 0.5) / 5) * (b.maxX - b.minX);
      const z = b.minZ + ((j + 0.5) / 5) * (b.maxZ - b.minZ);
      const a = namesAt(x, z);
      const c = namesAt(x + 0.013, z + 0.017);
      const aFloor = !!a.name && /floor/.test(a.name);
      const cFloor = !!c.name && /floor/.test(c.name);
      if (!aFloor && !cFloor) gaps.push({ x: +x.toFixed(1), z: +z.toFixed(1), hit: a.name, hit2: c.name });
    }
  }
  return {
    eye: { x: +eye.x.toFixed(2), y: +eye.y.toFixed(2), z: +eye.z.toFixed(2) },
    seen,
    floorGaps: gaps,
  };
};

if (mode === 'sight') {
  const periods = arg ? arg.split(',') : ALL_PERIODS;
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await openApp(page, null);
  for (const periodId of periods) {
    try {
      await enterFromTimeline(page, periodId);
      const sight = await page.evaluate(SIGHT_FN);
      console.log(`${periodId}  eye=(${sight.eye.x}, ${sight.eye.y}, ${sight.eye.z})`);
      console.log('   视线命中:', JSON.stringify(sight.seen));
      console.log(`   地板漏洞(非 floor 命中): ${sight.floorGaps.length}${sight.floorGaps.length ? ' ' + JSON.stringify(sight.floorGaps.slice(0, 6)) : ''}`);
      await backToTimeline(page);
    } catch (error) {
      console.log(`ERROR ${periodId}: ${String(error).split('\n')[0]}`);
    }
  }
  await browser.close();
  server.close();
  process.exit(0);
}

if (mode === 'geom') {
  const periods = arg ? arg.split(',') : ALL_PERIODS;
  let bad = 0;
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await openApp(page, null);
  for (const periodId of periods) {
    try {
      await enterFromTimeline(page, periodId);
      const audit = await page.evaluate(AUDIT_FN);
      const ok = !audit.overlaps.length && !audit.floaters.length;
      if (!ok) bad += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${periodId.padEnd(24)} frames=${audit.count} overlaps=${audit.overlaps.length} floaters=${audit.floaters.length}`);
      if (!ok) console.log('   ', JSON.stringify({ overlaps: audit.overlaps, floaters: audit.floaters }));
      await backToTimeline(page);
    } catch (error) {
      bad += 1;
      console.log(`ERROR ${periodId.padEnd(24)} ${String(error).split('\n')[0]}`);
      try {
        await page.goto(`${baseUrl}?smoke=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await openApp(page, null);
      } catch { /* 页面已不可用，后续房间也会报错 */ }
    }
  }
  console.log(bad === 0 ? `\nGEOMETRY PASS (${periods.length} rooms)` : `\nGEOMETRY FAIL (${bad}/${periods.length} rooms)`);
  await browser.close();
  server.close();
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'load') {
  const periodId = arg || 'early-renaissance';
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}?smoke=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('.welcome-start'), { timeout: 30000 });
  await page.evaluate(() => window.__timeGallery.setLang('en'));
  await page.click('.welcome-start');
  await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 30000 });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');

  // 轮询材质贴图来源：缩略图先到（thumb），原图后到（art）。
  async function measure(label) {
    const t0 = Date.now();
    let firstThumb = null;
    let allThumb = null;
    let firstArt = null;
    let allArt = null;
    const samples = [];
    const deadline = Date.now() + 420000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => {
        const engine = window.__timeGalleryEngine;
        if (!engine || !engine.canvasMeshes.length) return null;
        return engine.canvasMeshes.map((m) => {
          const src = m.material.map && m.material.map.image && m.material.map.image.src ? m.material.map.image.src : '';
          return src.includes('/thumb/') ? 'thumb' : (src.includes('/art/') ? 'art' : 'placeholder');
        });
      });
      if (state) {
        const elapsed = (Date.now() - t0) / 1000;
        const thumbs = state.filter((s) => s === 'thumb').length;
        const arts = state.filter((s) => s === 'art').length;
        if (firstThumb === null && thumbs > 0) firstThumb = elapsed;
        if (allThumb === null && thumbs === state.length) allThumb = elapsed;
        if (firstArt === null && arts > 0) firstArt = elapsed;
        if (allArt === null && arts === state.length) { allArt = elapsed; break; }
        if (samples.length < 40) samples.push({ t: +elapsed.toFixed(1), thumbs, arts });
      }
      await sleep(1000);
    }
    return { label, firstThumbSeconds: firstThumb, allThumbSeconds: allThumb, firstArtSeconds: firstArt, allArtSeconds: allArt, samples };
  }

  async function enterWithThrottle(clearCache) {
    if (clearCache) await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: 13 * 1024, uploadThroughput: 13 * 1024, latency: 400 });
    await page.click(`.timeline-node[data-id="${periodId}"] .node-main`);
    await page.waitForFunction(() => !!document.querySelector('.gallery-canvas canvas'), { timeout: 120000 });
  }

  // 第一趟（贴近真实首访）：时间线已把缩略图预取进缓存，缓存不清，只有原图是冷的。
  await sleep(3000);
  await enterWithThrottle(false);
  const warm = await measure('warm: thumbs cached from timeline (real first-visit path)');
  console.log(JSON.stringify(warm, null, 2));

  // 第二趟（最坏情况）：连缩略图缓存也清掉，两级都要走 13KB/s。
  await page.click('.gallery-back');
  await page.waitForFunction(() => document.querySelectorAll('.timeline-node').length === 12, { timeout: 30000 });
  await enterWithThrottle(true);
  const cold = await measure('cold: cache cleared, both stages over 13KB/s');
  console.log(JSON.stringify(cold, null, 2));

  const report = { periodId, throttle: '13KB/s + 400ms', warm, cold };
  fs.writeFileSync(path.join(outDir, `load-${periodId}.json`), JSON.stringify(report, null, 2));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 });
  await browser.close();
  server.close();
  process.exit(0);
}

console.log('usage: node tools/_verify.mjs geom [r1,r2] | load [period]');
await browser.close();
server.close();
process.exit(2);
