import { LANG_EN, LANG_ZH, getLang, setLang } from './lang.js';
import { t } from './strings.js';

// 语言切换控件（两段式按钮组）。
// variant='default'：欢迎页首屏，按钮至少 44px 命中区域；
// variant='compact'：3D 展厅 HUD 里的常驻小号控件。
// 返回 { element, sync }：element 挂进宿主 DOM，sync 在语言变化后由宿主调用。
export function createLanguageToggle({ variant = 'default' } = {}) {
  const element = document.createElement('div');
  element.className = `language-toggle language-toggle--${variant}`;
  element.setAttribute('role', 'group');

  const buttons = [LANG_EN, LANG_ZH].map((code) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'language-toggle__option';
    button.dataset.lang = code;
    // 展厅 HUD 里点击不能穿透到画布（否则会触发指针锁定 / 拾取画作）。
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setLang(code);
    });
    element.appendChild(button);
    return button;
  });

  function sync() {
    const lang = getLang();
    element.setAttribute('aria-label', t('lang.label'));
    for (const button of buttons) {
      const isEnglish = button.dataset.lang === LANG_EN;
      const active = button.dataset.lang === lang;
      button.textContent = isEnglish ? t('lang.optionEn') : t('lang.optionZh');
      button.setAttribute('aria-label', isEnglish ? t('lang.selectEn') : t('lang.selectZh'));
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    }
  }

  sync();
  return { element, sync };
}
