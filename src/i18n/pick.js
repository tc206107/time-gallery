import { getLang, LANG_EN } from './lang.js';

function readable(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

// 取一条记录上按语言分写的字段。
// 英文界面优先 `${base}En`；缺失、空白或类型不可读时回退到基名字段 `${base}`；
// 两者都不可用则返回 fallback（默认空串）——渲染层永远拿不到 undefined 或空字符串。
export function pick(record, base, fallback = '') {
  if (!record) return fallback;
  const preferred = getLang() === LANG_EN ? record[`${base}En`] : record[base];
  const secondary = getLang() === LANG_EN ? record[base] : record[`${base}En`];
  const value = readable(preferred) ? preferred : readable(secondary) ? secondary : null;
  if (value === null) return fallback;
  return typeof value === 'string' ? value.trim() : value;
}
