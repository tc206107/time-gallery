// 语言状态：单一真源 + 订阅通知；持久化到 localStorage，默认英文。
// 需求规定「未存过语言时用英文」，故 DEFAULT_LANG 固定为 en，
// 与 manifest.project.defaultLang（英文内容侧同步设为 "en"）保持一致。
const STORAGE_KEY = 'timegallery.lang';

export const LANG_EN = 'en';
export const LANG_ZH = 'zh-CN';
export const DEFAULT_LANG = LANG_EN;

const listeners = new Set();
let current = null;

// 把 en / en-US / zh / zh-CN / zh-Hans 之类统一成两种受支持的语言标签。
export function normalizeLang(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text === 'en' || text.startsWith('en-') || text.startsWith('en_')) return LANG_EN;
  if (text === 'zh' || text.startsWith('zh-') || text.startsWith('zh_') || text === 'cn') return LANG_ZH;
  return null;
}

function readStored() {
  try {
    return normalizeLang(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // 隐私模式 / 禁用存储时静默降级为默认语言，不影响渲染。
    return null;
  }
}

function writeStored(lang) {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* 忽略写入失败 */
  }
}

// URL 覆盖（?lang=en|zh）：给自动化脚本与分享链接一个直达某种语言的入口，优先级高于 localStorage。
function readQueryLang() {
  try {
    return normalizeLang(new URLSearchParams(window.location.search).get('lang'));
  } catch {
    return null;
  }
}

export function getLang() {
  if (current === null) current = readQueryLang() || readStored() || DEFAULT_LANG;
  return current;
}

export function setLang(lang, { persist = true } = {}) {
  const next = normalizeLang(lang) || DEFAULT_LANG;
  if (next === getLang()) {
    applyDocumentLang(next);
    return next;
  }
  current = next;
  if (persist) writeStored(next);
  applyDocumentLang(next);
  for (const listener of listeners) listener(next);
  return next;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// <html lang> 必须跟着走：屏幕阅读器、字体回退与搜索摘要都依赖它。
export function applyDocumentLang(lang = getLang()) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = normalizeLang(lang) || DEFAULT_LANG;
}

export { STORAGE_KEY };
