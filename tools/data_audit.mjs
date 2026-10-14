// data_audit.mjs — manifest 数据完整性验收脚本
// 用法: node tools/data_audit.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pub = join(root, 'public');

const results = {
  periods: 0,
  artists: 0,
  artworks: 0,
  periodIds: [],
  artistIds: [],
  missingFields: [],
  missingImages: [],
  badRefs: [],
  dimensionIssues: [],
  duplicateIds: [],
  unlicensed: [],
};

// 顶层集合
results.periods = manifest.periods.length;
results.artists = manifest.artists.length;
results.artworks = manifest.artworks.length;
results.periodIds = manifest.periods.map((p) => p.id);
results.artistIds = manifest.artists.map((a) => a.id);

const periodSet = new Set(results.periodIds);
const artistSet = new Set(results.artistIds);
const artIdSet = new Set();

for (const art of manifest.artworks) {
  // 重复 id
  if (artIdSet.has(art.id)) results.duplicateIds.push(art.id);
  artIdSet.add(art.id);

  // 必填字段
  for (const f of ['id', 'title', 'titleEn', 'artistId', 'periodId', 'year', 'image']) {
    if (!(f in art) || art[f] === '') results.missingFields.push(`${art.id}:${f}`);
  }
  // 物理尺寸字段
  for (const f of ['physicalWidthCm', 'physicalHeightCm']) {
    if (!(f in art) || typeof art[f] !== 'number' || !isFinite(art[f])) {
      results.missingFields.push(`${art.id}:${f}`);
    }
  }

  // 外键引用
  if (!periodSet.has(art.periodId)) results.badRefs.push(`${art.id}:period=${art.periodId}`);
  if (!artistSet.has(art.artistId)) results.badRefs.push(`${art.id}:artist=${art.artistId}`);

  // 本地图片存在性
  if (!art.image) continue;
  const filename = art.image.split('/').pop();
  const imgPath = filename.startsWith('a') || /\.(jpe?g|png|webp)$/i.test(filename)
    ? join(pub, 'assets', 'art', filename)
    : join(pub, art.image.replace(/^\//, ''));
  if (!existsSync(imgPath)) results.missingImages.push(art.image);

  // 尺寸合理性：宽高都应为正数
  const w = art.physicalWidthCm, h = art.physicalHeightCm;
  if (!(w > 0 && h > 0)) results.dimensionIssues.push(`${art.id}:w=${w},h=${h}`);

  // 开源许可字段
  if (!art.license || !art.licenseUrl) results.unlicensed.push(art.id);
}

// 每时期画作数量统计
const perPeriod = {};
for (const art of manifest.artworks) {
  perPeriod[art.periodId] = (perPeriod[art.periodId] || 0) + 1;
}

const report = {
  ...results,
  perPeriod,
  countsPerPeriod: Object.values(perPeriod),
  allPeriodsHaveEight: Object.values(perPeriod).every((n) => n === 8),
};
console.log(JSON.stringify(report, null, 2));
