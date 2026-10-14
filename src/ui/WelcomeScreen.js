import { createLanguageToggle } from '../i18n/LanguageToggle.js';
import { t } from '../i18n/strings.js';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export class WelcomeScreen {
  constructor({ container, onStart }) {
    this.container = container;
    this.onStart = onStart;
    this.el = null;
    this.langToggle = null;
    this.handleStart = this.handleStart.bind(this);
  }

  show() {
    if (!this.el) {
      this.el = document.createElement('section');
      this.el.className = 'screen welcome-screen';
      this.el.innerHTML = `
        <div class="welcome-bg" aria-hidden="true">
          <span class="doodle doodle-arc"></span>
          <span class="doodle doodle-ring"></span>
          <span class="doodle doodle-block block-a"></span>
          <span class="doodle doodle-block block-b"></span>
          <span class="doodle doodle-block block-c"></span>
          <span class="line line-h"></span>
          <span class="line line-v"></span>
          <span class="line line-diagonal"></span>
        </div>
        <div class="welcome-stage">
          <div class="blue-arch" aria-hidden="true"></div>
          <div class="welcome-copy">
            <div class="welcome-lang"></div>
            <p class="welcome-kicker"></p>
            <h1 class="welcome-title"></h1>
            <p class="welcome-subtitle"></p>
            <button class="primary-button welcome-start" type="button"></button>
          </div>
        </div>
      `;
      this.container.appendChild(this.el);

      // 语言切换器放在文案列内（文档流），从布局上排除与标题/按钮重叠的可能。
      this.langToggle = createLanguageToggle({ variant: 'default' });
      this.el.querySelector('.welcome-lang').appendChild(this.langToggle.element);

      this.el.querySelector('.welcome-start').addEventListener('click', this.handleStart);
    }
    this.applyStrings();
    this.el.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.el.classList.add('is-active'));
    });
  }

  // 语言变化后重刷首屏文案（不重建 DOM、不影响入场动画状态）。
  applyStrings() {
    if (!this.el) return;
    this.el.setAttribute('aria-label', t('welcome.aria'));
    this.el.querySelector('.welcome-kicker').textContent = t('welcome.kicker');
    this.el.querySelector('.welcome-title').textContent = t('welcome.title');
    this.el.querySelector('.welcome-subtitle').textContent = t('welcome.subtitle');
    this.el.querySelector('.welcome-start').textContent = t('welcome.start');
    this.langToggle?.sync();
  }

  hide() {
    if (!this.el) return;
    this.el.classList.remove('is-active');
    window.setTimeout(() => {
      this.el.hidden = true;
    }, 520);
  }

  handleStart() {
    this.onStart();
  }

  destroy() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.langToggle = null;
  }
}

export { EASE };
