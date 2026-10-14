export class ArtworkDetail {
  constructor({ container }) {
    this.container = container;
    this.el = null;
    this.visible = false;
    this.hideTimer = null;
  }

  show(artwork, artistsById, periodsById) {
    if (!this.el) {
      this.el = document.createElement('section');
      this.el.className = 'detail-overlay';
      this.el.setAttribute('aria-label', '画作详情');
      this.el.innerHTML = `
        <button class="icon-button detail-close" type="button" aria-label="关闭详情">×</button>
        <div class="detail-panel"></div>
      `;
      this.el.querySelector('.detail-close').addEventListener('click', () => this.hide());
      this.container.appendChild(this.el);
    }

    const artist = artistsById.get(artwork.artistId);
    const period = periodsById.get(artwork.periodId);
    const life = artist
      ? `${artist.birthYear || '？'}—${artist.deathYear || '？'}`
      : '年代久远，作者佚名';
    const panel = this.el.querySelector('.detail-panel');
    panel.innerHTML = `
      <div class="detail-image-wrap">
        <img src="${artwork.image}" alt="${artwork.title}" />
        <span class="detail-dimensions">${artwork.imageWidth || artwork.originalWidth || ''} × ${artwork.imageHeight || artwork.originalHeight || ''} px</span>
      </div>
      <div class="detail-info">
        <p class="detail-period">${period ? `${period.name} · ${period.range}` : ''}</p>
        <h1>${artwork.title}</h1>
        <p class="detail-title-en">${artwork.titleEn}</p>
        <dl class="detail-facts">
          <div><dt>画家</dt><dd>${artist ? `${artist.name}（${artist.nameEn}）` : '佚名'}</dd></div>
          <div><dt>生卒</dt><dd>${life}</div>
          <div><dt>年代</dt><dd>${artwork.year}</dd></div>
          <div><dt>时期</dt><dd>${period ? period.description : ''}</dd></div>
          <div><dt>来源</dt><dd>${artwork.source || '本地资产'}</dd></div>
          <div><dt>授权</dt><dd>${artwork.license || '公有领域'} ${artwork.licenseUrl ? `（${artwork.licenseUrl}）` : ''}</dd></div>
        </dl>
        <p class="detail-description">${artwork.description}</p>
      </div>
    `;

    this.el.hidden = false;
    this.visible = true;
    window.clearTimeout(this.hideTimer);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.el.classList.add('is-active'));
    });
  }

  hide() {
    if (!this.el || !this.visible) return;
    this.visible = false;
    this.el.classList.remove('is-active');
    this.hideTimer = window.setTimeout(() => {
      this.el.hidden = true;
    }, 380);
  }

  isVisible() {
    return this.visible;
  }

  destroy() {
    if (this.el) this.el.remove();
    this.el = null;
    this.visible = false;
  }
}
