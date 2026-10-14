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
      this.el.setAttribute('aria-label', '时间轴');
      this.el.innerHTML = `
        <header class="timeline-header">
          <div>
            <p class="screen-kicker">树状时间轴</p>
            <h1>十二个时代的图像现场</h1>
          </div>
          <p class="timeline-hint">悬停查看代表画作，点击节点进入该时期画廊</p>
        </header>
        <div class="timeline-scroll">
          <div class="timeline-tree"></div>
        </div>
      `;
      this.container.appendChild(this.el);
    }

    const tree = this.el.querySelector('.timeline-tree');
    tree.innerHTML = '';
    this.handlers.clear();

    periods.forEach((period, index) => {
      const works = artworks.filter((item) => item.periodId === period.id);
      const node = document.createElement('article');
      node.className = 'timeline-node';
      node.dataset.id = period.id;
      node.style.setProperty('--node-index', index);

      const painters = [...new Set(works.map((item) => {
        const artist = this.artistsById?.get(item.artistId);
        return artist ? artist.name : '佚名';
      }))].slice(0, 8).join(' · ');

      const thumbs = works.slice(0, 3).map((work) => `
        <img src="${work.thumb || work.image}" alt="${work.title}" loading="lazy" />
      `).join('');

      node.innerHTML = `
        <div class="node-main" role="button" tabindex="0" aria-label="进入${period.name}画廊">
          <div class="node-artists" aria-hidden="true">${painters}</div>
          <div class="node-core">
            <span class="node-range">${period.range}</span>
            <h2>${period.name}</h2>
            <span class="node-count">${works.length} 幅画作</span>
          </div>
        </div>
        <div class="timeline-card">
          <div class="card-thumbs">${thumbs}</div>
          <div class="card-copy">
            <h3>${period.name}</h3>
            <p>${period.description}</p>
          </div>
        </div>
      `;

      const main = node.querySelector('.node-main');
      const activate = (event) => {
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.onPeriodSelected(period.id);
      };
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
