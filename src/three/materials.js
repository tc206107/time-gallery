import * as THREE from 'three';

const defaultSurface = {
  color: 0xd7d0c6,
  map: null,
  roughness: 0.66,
  metalness: 0.015,
  clearcoat: 0.035,
  clearcoatRoughness: 0.72,
  sheen: 0,
  sheenColor: 0xffffff,
  side: THREE.FrontSide,
  transparent: false,
  opacity: 1,
};

export function createSurfaceMaterial(options = {}) {
  const settings = { ...defaultSurface, ...options };
  return new THREE.MeshPhysicalMaterial({
    color: settings.color,
    map: settings.map,
    roughness: settings.roughness,
    metalness: settings.metalness,
    clearcoat: settings.clearcoat,
    clearcoatRoughness: settings.clearcoatRoughness,
    sheen: settings.sheen,
    sheenColor: settings.sheenColor,
    side: settings.side,
    transparent: settings.transparent,
    opacity: settings.opacity,
    emissive: settings.emissive ?? 0x000000,
    emissiveIntensity: settings.emissiveIntensity ?? 0,
  });
}

function seededNoise(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function makeNoiseTexture(base, accent = null, size = 256, grain = 0.04) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const color = accent ? new THREE.Color(accent) : new THREE.Color(base).clone().multiplyScalar(1.08);
  const fill = new THREE.Color(base);
  const pixels = ctx.createImageData(size, size);
  const noise = seededNoise(13);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const n = (noise() - 0.5) * grain;
    pixels.data[i] = Math.max(0, Math.min(255, fill.r * 255 + n * 255));
    pixels.data[i + 1] = Math.max(0, Math.min(255, fill.g * 255 + n * 255));
    pixels.data[i + 2] = Math.max(0, Math.min(255, fill.b * 255 + n * 255));
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = `#${color.getHexString()}`;
  for (let i = 0; i < 90; i += 1) {
    ctx.beginPath();
    ctx.arc(noise() * size, noise() * size, 0.6 + noise() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export function makeMarbleTexture(base = '#d8d2c8', vein = '#a8a094', size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const bg = new THREE.Color(base);
  const v = new THREE.Color(vein);
  ctx.fillStyle = `#${bg.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = `#${v.getHexString()}`;
  const noise = seededNoise(37);
  for (let i = 0; i < 26; i += 1) {
    const x = noise() * size;
    const y = noise() * size;
    ctx.lineWidth = 0.5 + noise() * 1.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + size * 0.18, y - size * 0.12, x + size * 0.3, y + size * 0.12, x + size * 0.42, y + size * 0.02);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 70; i += 1) {
    ctx.beginPath();
    ctx.arc(noise() * size, noise() * size, 0.5 + noise() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = 8;
  return texture;
}

export function makeCofferTexture(base = '#c8c2b7', accent = '#918b80', size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const bg = new THREE.Color(base);
  const edge = new THREE.Color(accent);
  ctx.fillStyle = `#${bg.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = `#${edge.getHexString()}`;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 4;
  const cell = 128;
  for (let x = 0; x < size; x += cell) {
    for (let y = 0; y < size; y += cell) {
      ctx.strokeRect(x + 9, y + 9, cell - 18, cell - 18);
    }
  }
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#ffffff';
  for (let x = 0; x < size; x += cell) {
    for (let y = 0; y < size; y += cell) {
      ctx.fillRect(x + 18, y + 18, cell - 36, cell - 36);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = 6;
  return texture;
}

export function makeFrameTexture() {
  return makeGildedTexture();
}

export function makeGildedTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#b99c62');
  gradient.addColorStop(0.48, '#79623d');
  gradient.addColorStop(1, '#d2b578');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255, 235, 180, 0.38)';
  ctx.lineWidth = 7;
  ctx.strokeRect(9, 9, size - 18, size - 18);
  ctx.strokeStyle = 'rgba(46, 34, 18, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, size - 48, size - 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeSteelTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, '#a8adb0');
  gradient.addColorStop(0.5, '#687074');
  gradient.addColorStop(1, '#b3b8bb');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  const noise = seededNoise(71);
  for (let i = 0; i < 80; i += 1) {
    ctx.fillRect(noise() * size, noise() * size, 8 + noise() * 30, 0.7 + noise() * 1.4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 6;
  return texture;
}

export function makeWoodFloorTexture(base = '#a68c70', accent = '#755b46', size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const bg = new THREE.Color(base);
  const edge = new THREE.Color(accent);
  ctx.fillStyle = `#${bg.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = `#${edge.getHexString()}`;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 2;
  for (let x = 0; x <= size; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  const noise = seededNoise(97);
  for (let i = 0; i < 110; i += 1) {
    ctx.fillRect(noise() * size, noise() * size, 18 + noise() * 70, 0.6 + noise() * 1.5);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.anisotropy = 6;
  return texture;
}

export function makeLabelTexture(text, width = 512, height = 96) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(26, 24, 21, 0.82)';
  ctx.beginPath();
  ctx.roundRect(8, 8, width - 16, height - 16, 14);
  ctx.fill();
  ctx.fillStyle = '#f7f2e8';
  ctx.font = '700 34px system-ui, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 2, width - 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeFallbackTexture(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 800, 600);
  gradient.addColorStop(0, '#8ea3b5');
  gradient.addColorStop(0.5, '#d2c8b5');
  gradient.addColorStop(1, '#aa6f58');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 800, 600);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(400, 320, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f7f2e8';
  ctx.font = '700 42px system-ui, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title || 'Time Gallery', 400, 300);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeWallTexture(base, accent = null, pattern = 'panel', size = 512) {
  if (pattern === 'stripes' || pattern === 'brick' || pattern === 'concrete' || pattern === 'panels') {
    return makeNoiseTexture(base, accent, size, pattern === 'brick' ? 0.025 : 0.035);
  }
  return makeNoiseTexture(base, accent, size, 0.035);
}
