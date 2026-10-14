import manifest, { artists, artistsById, artworks, periods, periodsById } from './data/artworks.js';
import { ArtworkDetail, Timeline, WelcomeScreen } from './ui/index.js';
import { GalleryEngine } from './three/index.js';
import './styles.css';

const app = document.querySelector('#app');
let currentScreen = 'welcome';
let currentArtwork = null;

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

welcome.show();
