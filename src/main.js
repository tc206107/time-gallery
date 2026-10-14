import manifest, { artists, artistsById, artworks, periods, periodsById } from './data/artworks.js';
import { applyDocumentLang, getLang, pick, setLang, subscribe, t } from './i18n/index.js';
import { ArtworkDetail, Timeline, WelcomeScreen } from './ui/index.js';
import { GalleryEngine } from './three/index.js';
import './styles.css';

const app = document.querySelector('#app');
let currentScreen = 'welcome';
let currentArtwork = null;

// 文档级元信息（<html lang> / <title> / description / iOS 主屏名）跟着语言走。
function setMetaContent(selector, value) {
  const el = document.querySelector(selector);
  if (el && value) el.setAttribute('content', value);
}

function applyDocumentMeta() {
  const project = manifest.project || {};
  const title = pick(project, 'name', t('doc.title'));
  applyDocumentLang(getLang());
  document.title = title;
  setMetaContent('meta[name="description"]', pick(project, 'description', t('doc.description')));
  setMetaContent('meta[name="apple-mobile-web-app-title"]', title);
}

const welcome = new WelcomeScreen({
  container: app,
  onStart: () => {
    welcome.hide();
    timeline.show(periods, artworks);
    currentScreen = 'timeline';
  },
});

const timeline = new Timeline({
  container: app,
  onPeriodSelected: (periodId) => {
    enterGallery(periodId);
  },
});
timeline.setArtists(artists);

const detail = new ArtworkDetail({ container: app });
const gallery = new GalleryEngine({
  container: app,
  onBack: () => {
    detail.hide();
    gallery.hide();
    currentArtwork = null;
    timeline.show(periods, artworks);
    currentScreen = 'timeline';
  },
});

async function enterGallery(periodId) {
  if (currentScreen === 'gallery' && gallery.currentPeriodId === periodId) return;
  timeline.hide();
  detail.hide();
  currentArtwork = null;
  await gallery.init();
  gallery.show(manifest, periodId);
  currentScreen = 'gallery';
}

gallery.onArtworkClick((artworkId) => {
  const artwork = artworks.find((item) => item.id === artworkId);
  if (!artwork) return;
  currentArtwork = artwork;
  gallery.exitPointerLock();
  detail.show(artwork, artistsById, periodsById);
});

if (new URLSearchParams(window.location.search).has('smoke')) {
  // 调试接缝：把引擎实例本身交给自动化脚本，供几何审计（画框嵌合/悬空/越界）直接读场景图。
  // THREE 句柄由 GalleryEngine 在 smoke 模式下挂到 window（那里已按命名空间引入，不增包体）。
  window.__timeGalleryEngine = gallery;
  window.__timeGallery = {
    openArtwork(artworkId) {
      const artwork = artworks.find((item) => item.id === artworkId);
      if (!artwork) return;
      currentArtwork = artwork;
      gallery.exitPointerLock();
      detail.show(artwork, artistsById, periodsById);
    },
    getArtworkTransforms() {
      return gallery.getArtworkTransforms();
    },
    aimAtArtwork(artworkId) {
      return gallery.aimAtArtwork(artworkId);
    },
    getArtworkOcclusion() {
      return gallery.getArtworkOcclusion();
    },
    // 语言自检接缝：详情面板盖住 HUD 时仍需能切语言（见 tools/_i18n-check.mjs）。
    setLang(lang) {
      return setLang(lang);
    },
    getLang() {
      return getLang();
    },
  };
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'KeyE' && !event.ctrlKey && !event.metaKey && currentScreen === 'gallery') {
    if (detail.isVisible()) {
      detail.hide();
    } else if (currentArtwork) {
      gallery.exitPointerLock();
      detail.show(currentArtwork, artistsById, periodsById);
    }
  }
  if (event.code === 'Escape' && detail.isVisible()) {
    detail.hide();
  }
});

// 语言切换的唯一分发点：先落地文档级元信息，再重刷「当前那一屏」。
// 画廊屏只重刷 HUD 文本与 CSS2D 标注，不重建 renderer（见 GalleryEngine.refreshLanguage）。
subscribe(() => {
  applyDocumentMeta();
  if (currentScreen === 'gallery') {
    gallery.refreshLanguage();
    detail.refreshLanguage();
    return;
  }
  if (currentScreen === 'timeline') {
    timeline.show(periods, artworks);
    return;
  }
  welcome.show();
});

applyDocumentMeta();
welcome.show();
