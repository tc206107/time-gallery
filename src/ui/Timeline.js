import { pick } from '../i18n/pick.js';
import { t } from '../i18n/strings.js';

export class Timeline {
  constructor({ container, onPeriodSelected }) {
    this.container = container;
    this.onPeriodSelected = onPeriodSelected;
    this.el = null;
    this.handlers = new Map();
  }

  show(periods, artworks) {
    if (!this.el) {
      this.el = document.createElement('section');
      this.el.className = 'screen timeline-screen';
      this.el.innerHTML = `
        <header class="timeline-header">
          <div>
            <p class="screen-kicker"></p>
            <h1></h1>
          </div>
          <p class="timeline-hint"></p>
        </header>
        <div class="timeline-scroll">
          <div class="timeline-tree"></div>
        </div>
      `;
      this.container.appendChild(this.el);
    }

    // 时间轴是纯 DOM：语言切换时整棵重渲染即可，无 WebGL 代价。
    this.el.setAttribute('aria-label', t('timeline.aria'));
    this.el.querySelector('.screen-kicker').textContent = t('timeline.kicker');
    this.el.querySelector('.timeline-header h1').textContent = t('timeline.title');
    this.el.querySelector('.timeline-hint').textContent = t('timeline.hint');

    const tree = this.el.querySelector('.timeline-tree');
    tree.innerHTML = '';
    this.handlers.clear();

    periods.forEach((period, index) => {
      const works = artworks.filter((item) => item.periodId === period.id);
      const periodName = pick(period, 'name', period.id);
      const node = document.createElement('article');
      node.className = 'timeline-node';
      node.dataset.id = period.id;
      node.style.setProperty('--node-index', index);

      const painters = [...new Set(works.map((item) => {
        const artist = this.artistsById?.get(item.artistId);
        return artist ? pick(artist, 'name', t('timeline.unknownArtist')) : t('timeline.unknownArtist');
      }))].slice(0, 8).join(' · ');

      const thumbs = works.slice(0, 3).map((work) => {
        const title = pick(work, 'title');
        return `
        <img src="${work.thumb || work.image}" alt="${title}" loading="lazy" />
      `;
      }).join('');

      node.innerHTML = `
        <div class="node-main" role="button" tabindex="0">
          <div class="node-artists" aria-hidden="true">${painters}</div>
          <div class="node-core">
            <span class="node-range">${pick(period, 'range')}</span>
            <h2>${periodName}</h2>
            <span class="node-count">${t('timeline.artworkCount', { count: works.length })}</span>
          </div>
        </div>
        <div class="timeline-card">
          <div class="card-thumbs">${thumbs}</div>
          <div class="card-copy">
            <h3>${periodName}</h3>
            <p>${pick(period, 'description')}</p>
          </div>
        </div>
      `;

      const main = node.querySelector('.node-main');
      const activate = (event) => {
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.onPeriodSelected(period.id);
      };
      main.setAttribute('aria-label', t('timeline.enterPeriod', { period: periodName }));
      main.addEventListener('click', activate);
      main.addEventListener('keydown', activate);
      this.handlers.set(main, activate);
      tree.appendChild(node);
    });

    this.el.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.el.classList.add('is-active'));
    });
  }

  setArtists(artists) {
    this.artistsById = new Map(artists.map((artist) => [artist.id, artist]));
  }

  hide() {
    if (!this.el) return;
    this.el.classList.remove('is-active');
    window.setTimeout(() => {
      this.el.hidden = true;
    }, 520);
  }

  destroy() {
    this.handlers.forEach((handler, node) => {
      node.removeEventListener('click', handler);
      node.removeEventListener('keydown', handler);
    });
    if (this.el) this.el.remove();
    this.el = null;
  }
}
