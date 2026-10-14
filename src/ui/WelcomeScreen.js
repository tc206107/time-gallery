const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export class WelcomeScreen {
  constructor({ container, onStart }) {
    this.container = container;
    this.onStart = onStart;
    this.el = null;
    this.handleStart = this.handleStart.bind(this);
  }

  show() {
    if (!this.el) {
      this.el = document.createElement('section');
      this.el.className = 'screen welcome-screen';
      this.el.setAttribute('aria-label', '欢迎');
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
            <p class="welcome-kicker">艺术与观念 · Arts and Ideas</p>
            <h1 class="welcome-title">时光画廊</h1>
            <p class="welcome-subtitle">从洞穴壁画到现代主义，步入十二个时代的图像现场</p>
            <button class="primary-button welcome-start" type="button">进入时间轴</button>
          </div>
        </div>
      `;
      this.container.appendChild(this.el);
      this.el.querySelector('.welcome-start').addEventListener('click', this.handleStart);
    }
    this.el.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.el.classList.add('is-active'));
    });
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
  }
}

export { EASE };
