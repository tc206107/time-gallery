import { LANG_ZH, getLang } from '../i18n/lang.js';
import { pick } from '../i18n/pick.js';
import { t } from '../i18n/strings.js';

// 画家名：中文界面沿用「中文名（英文名）」，英文界面只给英文名，避免中英混排。
function formatArtistName(artist) {
  if (!artist) return t('detail.unknownArtist');
  const primary = pick(artist, 'name', t('detail.unknownArtist'));
  if (getLang() !== LANG_ZH) return primary;
  const english = typeof artist.nameEn === 'string' ? artist.nameEn.trim() : '';
  return english && english !== primary ? `${primary}（${english}）` : primary;
}

export class ArtworkDetail {
  constructor({ container }) {
    this.container = container;
    this.el = null;
    this.visible = false;
    this.hideTimer = null;
    this.current = null;
  }

  show(artwork, artistsById, periodsById) {
    // 记住当前画作：语言切换时按新语言重渲染同一个面板。
    this.current = { artwork, artistsById, periodsById };

    if (!this.el) {
      this.el = document.createElement('section');
      this.el.className = 'detail-overlay';
      this.el.innerHTML = `
        <button class="icon-button detail-close" type="button">×</button>
        <div class="detail-panel"></div>
      `;
      this.el.querySelector('.detail-close').addEventListener('click', () => this.hide());
      this.container.appendChild(this.el);
    }

    this.el.setAttribute('aria-label', t('detail.aria'));
    this.el.querySelector('.detail-close').setAttribute('aria-label', t('detail.close'));

    const artist = artistsById.get(artwork.artistId);
    const period = periodsById.get(artwork.periodId);
    const unknownYear = t('detail.unknownYear');
    const life = artist
      ? `${artist.birthYear || unknownYear}—${artist.deathYear || unknownYear}`
      : t('detail.unknownLifetime');
    const title = pick(artwork, 'title');
    // 中文界面在标题下补一行英文原名；英文界面标题本身就是英文，不再挂中文行。
    const secondaryTitle = getLang() === LANG_ZH ? pick(artwork, 'titleEn', '') : '';
    const license = pick(artwork, 'license', t('detail.publicDomain'));
    const licenseSuffix = artwork.licenseUrl
      ? (getLang() === LANG_ZH ? `（${artwork.licenseUrl}）` : ` (${artwork.licenseUrl})`)
      : '';

    const panel = this.el.querySelector('.detail-panel');
    panel.innerHTML = `
      <div class="detail-image-wrap">
        <img src="${artwork.image}" alt="${title}" />
        <span class="detail-dimensions">${artwork.imageWidth || artwork.originalWidth || ''} × ${artwork.imageHeight || artwork.originalHeight || ''} px</span>
      </div>
      <div class="detail-info">
        <p class="detail-period">${period ? `${pick(period, 'name')} · ${pick(period, 'range')}` : ''}</p>
        <h1>${title}</h1>
        ${secondaryTitle ? `<p class="detail-title-en">${secondaryTitle}</p>` : ''}
        <dl class="detail-facts">
          <div><dt>${t('detail.artist')}</dt><dd>${formatArtistName(artist)}</dd></div>
          <div><dt>${t('detail.lifespan')}</dt><dd>${life}</div>
          <div><dt>${t('detail.year')}</dt><dd>${pick(artwork, 'year')}</dd></div>
          <div><dt>${t('detail.period')}</dt><dd>${period ? pick(period, 'description') : ''}</dd></div>
          <div><dt>${t('detail.source')}</dt><dd>${artwork.source || t('detail.localAsset')}</dd></div>
          <div><dt>${t('detail.license')}</dt><dd>${license}${licenseSuffix}</dd></div>
        </dl>
        <p class="detail-description">${pick(artwork, 'description')}</p>
      </div>
    `;

    this.el.hidden = false;
    this.visible = true;
    window.clearTimeout(this.hideTimer);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.el.classList.add('is-active'));
    });
  }

  // 语言切换入口：面板可见时按当前语言重渲染。
  refreshLanguage() {
    if (!this.visible || !this.current) return;
    const { artwork, artistsById, periodsById } = this.current;
    this.show(artwork, artistsById, periodsById);
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
    this.current = null;
  }
}
