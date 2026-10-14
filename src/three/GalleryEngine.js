import * as THREE from 'three';
import { Box3, DoubleSide, Raycaster, Vector3 } from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createLanguageToggle } from '../i18n/LanguageToggle.js';
import { pick } from '../i18n/pick.js';
import { t } from '../i18n/strings.js';
import { FirstPersonControls } from './controls.js';
import { detectDevice } from './device.js';
import { buildPeriodRoom } from './room.js';
import { createPostFX } from './postfx.js';
import {
  createSurfaceMaterial,
  makeFallbackTexture,
  makeGildedTexture,
  makeMarbleTexture,
  makeNoiseTexture,
  makeSteelTexture,
  makeWoodFloorTexture,
} from './materials.js';

const TAP_MOVE_LIMIT = 10;
const CLICK_SUPPRESS_MS = 700;
const SLOW_FRAME_SECONDS = 0.033;
const FRAME_SAMPLE_COUNT = 45;
const LOW_POWER_PIXEL_RATIO_CAP = 1.5;
const DESKTOP_PIXEL_RATIO_CAP = 2;
const LOW_POWER_PIXEL_RATIOS = [1, 0.75];
const JOYSTICK_DEAD_ZONE = 0.16;

export class GalleryEngine {
  constructor({ container, onBack }) {
    this.container = container;
    this.onBack = onBack || (() => {});
    this.el = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.composer = null;
    this.labelRenderer = null;
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.artGroup = null;
    this.canvasMeshes = [];
    this.labelObjects = [];
    this.artworkClick = null;
    this.currentPeriodId = null;
    this.room = null;
    this.initialized = false;
    this.visible = false;
    this.isTouch = false;
    this.lowPower = false;
    this.ignoreClickUntil = 0;
    this.touchGesture = null;
    this.touchControls = null;
    this.joystick = null;
    this.joystickKnob = null;
    this.joystickPointerId = null;
    this.joystickRect = null;
    this.manifest = null;
    this.langToggle = null;
    this.pixelRatioLadder = [DESKTOP_PIXEL_RATIO_CAP];
    this.pixelRatioIndex = 0;
    this.frameSamples = [];
    this.loader = new THREE.TextureLoader();
    this.loadGeneration = 0;
    // 待发起的二级（原图）加载登记表：一个展厅的画全部登记完再按「离相机由近到远」发起。
    this.pendingFullLoads = [];
    this.spotTargets = [];
    this.onCanvasClick = this.onCanvasClick.bind(this);
    this.onCanvasPointerDown = this.onCanvasPointerDown.bind(this);
    this.onCanvasPointerMove = this.onCanvasPointerMove.bind(this);
    this.onCanvasPointerUp = this.onCanvasPointerUp.bind(this);
    this.onCanvasPointerCancel = this.onCanvasPointerCancel.bind(this);
    this.onJoystickDown = this.onJoystickDown.bind(this);
    this.onJoystickMove = this.onJoystickMove.bind(this);
    this.onJoystickEnd = this.onJoystickEnd.bind(this);
    this.onResize = this.onResize.bind(this);
  }

  async init() {
    if (this.initialized) return;
    // 调试接缝：smoke 模式下把几何审计需要的少数 THREE 成员挂上 window。
    // 只暴露用到的具名导入（不挂整个命名空间——那会阻止 Tree-shaking，实测包体 +188KB）。
    if (new URLSearchParams(window.location.search).has('smoke')) {
      window.__THREE = { Box3, Raycaster, Vector3, DoubleSide };
    }
    const device = detectDevice();
    this.isTouch = device.isTouch;
    this.lowPower = device.lowPower;
    this.setupQualityLadder();
    this.el = document.createElement('div');
    this.el.className = this.isTouch ? 'gallery-root is-touch' : 'gallery-root';
    // 文案一律留空、由 applyHudStrings() 填：这样 HUD 文本只有一个写入口，语言切换直接复用。
    this.el.innerHTML = `
      <div class="gallery-canvas"></div>
      <div class="gallery-hud">
        <div class="gallery-hud-left">
          <button class="secondary-button gallery-back" type="button"></button>
        </div>
        <div class="gallery-period"></div>
        <div class="gallery-controls-hint"></div>
      </div>
      <div class="pointer-hint">
        <strong></strong>
        <span></span>
      </div>
    `;
    this.container.appendChild(this.el);
    this.el.querySelector('.gallery-back').addEventListener('click', () => this.onBack());

    // 展厅内的常驻语言切换器（欢迎页那个是必需项，这里是同一控件的紧凑变体）。
    this.langToggle = createLanguageToggle({ variant: 'compact' });
    this.el.querySelector('.gallery-hud-left').appendChild(this.langToggle.element);
    this.applyHudStrings();

    const canvasHost = this.el.querySelector('.gallery-canvas');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatioLadder[0]);

    this.renderer.setSize(canvasHost.clientWidth || window.innerWidth, canvasHost.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    canvasHost.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#b7b8b2');
    this.scene.fog = new THREE.FogExp2(0xc5c3bc, 0.0032);

    this.camera = new THREE.PerspectiveCamera(
      62,
      (canvasHost.clientWidth || window.innerWidth) / (canvasHost.clientHeight || window.innerHeight),
      0.1,
      220,
    );
    this.camera.position.set(0, 2.7, 9.2);

    this.controls = new FirstPersonControls(this.camera, this.renderer.domElement, {
      onPointerLockChange: (locked) => this.setLocked(locked),
    });
    this.controls.setInitial(new THREE.Vector3(0, 2.7, 9.2), new THREE.Vector3(0, 3, 0));
    if (this.isTouch) this.buildTouchControls();

    this.addLights();
    this.composer = createPostFX(this.renderer, this.scene, this.camera, { ssao: !this.lowPower });
    const bloom = this.composer.passes.find(
      (pass) => typeof pass.strength === 'number' && typeof pass.threshold === 'number',
    );
    if (bloom) {
      bloom.strength = 0.025;
      bloom.threshold = 0.85;
      bloom.radius = 0.48;
    }
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'gallery-labels';
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.inset = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    canvasHost.appendChild(this.labelRenderer.domElement);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    this.renderer.domElement.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onCanvasPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onCanvasPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onCanvasPointerCancel);
    window.addEventListener('resize', this.onResize);
    this.initialized = true;
  }

  // HUD 文案的唯一定义处（back / 操作提示 / 指针提示 / 摇杆说明 + 切换器自身）。
  applyHudStrings() {
    if (!this.el) return;
    this.el.setAttribute('aria-label', t('gallery.aria'));
    this.el.querySelector('.gallery-back').textContent = t('gallery.back');
    this.el.querySelector('.gallery-controls-hint').textContent = this.isTouch
      ? t('gallery.hintTouch')
      : t('gallery.hintDesktop');
    this.el.querySelector('.pointer-hint strong').textContent = t('gallery.pointerHintTitle');
    this.el.querySelector('.pointer-hint span').textContent = t('gallery.pointerHintKeys');
    const caption = this.el.querySelector('.touch-joystick-caption');
    if (caption) caption.textContent = t('gallery.joystickCaption');
    this.langToggle?.sync();
  }

  applyPeriodLabel() {
    if (!this.el) return;
    const periodEl = this.el.querySelector('.gallery-period');
    const period = this.manifest?.periods?.find((item) => item.id === this.currentPeriodId);
    periodEl.textContent = period ? `${pick(period, 'name')} · ${pick(period, 'range')}` : '';
  }

  applyLabelText(entry) {
    entry.titleEl.textContent = pick(entry.work, 'title');
    entry.artistEl.textContent = entry.artist
      ? pick(entry.artist, 'name', t('gallery.unknownArtist'))
      : t('gallery.unknownArtist');
  }

  // 语言切换：只重刷 DOM/HUD 与 CSS2D 标注文本。
  // 刻意不重建 renderer、不重载贴图、不动场景图——3D 场景保持连续。
  refreshLanguage() {
    if (!this.el) return;
    this.applyHudStrings();
    this.applyPeriodLabel();
    for (const entry of this.labelObjects) this.applyLabelText(entry);
  }

  // Single capability decision for every touch/low-power quality knob: pixel ratio,
  // SSAO pass, shadow map size and the adaptive resolution ladder below.
  setupQualityLadder() {
    const devicePixelRatio = window.devicePixelRatio || 1;
    if (!this.lowPower) {
      this.pixelRatioLadder = [Math.min(devicePixelRatio, DESKTOP_PIXEL_RATIO_CAP)];
      this.pixelRatioIndex = 0;
      return;
    }
    const cap = Math.min(devicePixelRatio, LOW_POWER_PIXEL_RATIO_CAP);
    this.pixelRatioLadder = [cap, ...LOW_POWER_PIXEL_RATIOS.filter((value) => value < cap)];
    this.pixelRatioIndex = 0;
  }

  applyPixelRatio(index) {
    const ratio = this.pixelRatioLadder[index];
    if (!Number.isFinite(ratio) || !this.renderer) return;
    this.pixelRatioIndex = index;
    this.renderer.setPixelRatio(ratio);
    if (this.composer) this.composer.setPixelRatio(ratio);
    this.onResize();
  }

  // Steps down only, never up: avoids oscillating between two resolutions.
  trackFrameTime(delta) {
    if (!this.lowPower) return;
    if (this.pixelRatioIndex >= this.pixelRatioLadder.length - 1) return;
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.frameSamples.push(delta);
    if (this.frameSamples.length < FRAME_SAMPLE_COUNT) return;
    const total = this.frameSamples.reduce((sum, value) => sum + value, 0);
    const average = total / this.frameSamples.length;
    this.frameSamples.length = 0;
    if (average > SLOW_FRAME_SECONDS) this.applyPixelRatio(this.pixelRatioIndex + 1);
  }

  addLights() {
    const hemisphere = new THREE.HemisphereLight(0xf0f1ea, 0x848a84, 0.78);
    this.scene.add(hemisphere);

    const ambient = new THREE.AmbientLight(0xb7bdba, 0.5);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xf6f0e2, 0.85);
    sun.position.set(2, 18, 4);
    sun.target.position.set(0, 2, 0);
    sun.castShadow = true;
    const shadowMapSize = this.lowPower ? 512 : 1024;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -28;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 46;
    sun.shadow.bias = -0.00018;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  setData(manifest, periodId) {
    if (!this.initialized) return;
    this.manifest = manifest;
    this.setRoom(periodId);
    this.clearArtGroup();
    this.artGroup = new THREE.Group();
    this.artGroup.name = 'artwork-group';
    this.scene.add(this.artGroup);

    const works = manifest.artworks.filter((item) => item.periodId === periodId);
    this.currentPeriodId = periodId;
    this.canvasMeshes = [];
    this.labelObjects = [];

    this.applyPeriodLabel();

    works.forEach((work, index) => {
      const frameGroup = this.createFrame(work, works, index, manifest.artists);
      this.artGroup.add(frameGroup);
    });

    // 8 幅画全部登记完成后，才按「离相机由近到远」真正发起原图加载。
    // 实测本机到 GitHub Pages 只有 13 KB/s：按数组顺序发，站在眼前的那幅可能要等满 3 分钟；
    // 按距离发，近处的原图先落地，最坏情况下先清晰的是用户正在看的那一幅。
    // 一级（缩略图）不参与排序——它们只有 10–22 KB 且进厅前已全部在缓存里。
    const pending = this.pendingFullLoads;
    this.pendingFullLoads = [];
    pending.sort((a, b) => a.distance - b.distance);
    for (const entry of pending) {
      this.loadFullImage(entry.work, entry.material, entry.generation);
    }

    this.controls.setInitial(this.room.cameraStart, this.room.cameraLookAt);
  }

  getArtworkDisplaySize(work, works) {
    const aspect = this.getAspect(work);
    const physicalWidth = Number(work.physicalWidthCm);
    const physicalHeight = Number(work.physicalHeightCm);
    let width;
    let height;
    if (Number.isFinite(physicalWidth) && physicalWidth > 0 && Number.isFinite(physicalHeight) && physicalHeight > 0) {
      const widths = works
        .map((item) => Number(item.physicalWidthCm))
        .filter((value) => Number.isFinite(value) && value > 0);
      const maxWidth = widths.length ? Math.max(...widths) : physicalWidth;
      const relative = physicalWidth / Math.max(maxWidth, 1);
      width = 2.15 + relative * 2.45;
      height = width / aspect;
    } else {
      width = aspect >= 1 ? 2.85 : 2.45;
      height = width / aspect;
    }

    const maxHeight = Math.min(4.35, (this.room?.height || 8) * 0.54);
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    const maxWidth = Math.min(5.0, (this.room?.height || 8) * 0.68);
    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspect;
    }
    width = Math.max(1.55, Math.min(width, maxWidth));
    height = Math.min(Math.max(1.05, height), maxHeight);
    return { width, height, aspect };
  }

  createFrame(work, works, index, artists) {
    const group = new THREE.Group();
    const { width, height } = this.getArtworkDisplaySize(work, works);
    // 布点是无副作用的纯函数（只依赖 index / 作品数 / 作品尺寸），上移到方法前部，
    // 好让下面能算出这幅画到相机起点的距离，用于排序二级（原图）加载的发起顺序。
    const placement = this.room.getArtworkTransform(index, works.length, work);
    // 兜底贴图上的画名按当前语言生成；语言切换不重建贴图（正式贴图已覆盖绝大多数场合）。
    const fallback = makeFallbackTexture(pick(work, 'title'));
    const paintMaterial = new THREE.MeshLambertMaterial({
      map: fallback,
      color: 0xffffff,
      emissive: 0x000000,
    });
    const paintPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), paintMaterial);
    paintPlane.scale.set(width, height, 1);
    paintPlane.receiveShadow = true;
    paintPlane.name = 'artwork-canvas';

    const generation = this.loadGeneration;

    // 两级渐进加载。两级【同时】发起、不串行等缩略图：慢网下串行会把原图的等待时间再叠一层。
    // 一级：缩略图（单张 10–22 KB，约为原图的 1/20，且时间线界面进入前已把 96 张全部预热进缓存），
    // 通常立刻命中缓存，用来尽快把占位图换成一张真正能看的画。
    const thumbUrl = typeof work.thumb === 'string' ? work.thumb.trim() : '';
    if (thumbUrl) {
      this.loader.load(
        thumbUrl,
        (texture) => {
          if (generation !== this.loadGeneration) {
            texture.dispose();
            return;
          }
          // 原图已经先到（极端时序：缩略图未命中缓存而原图命中了），就不要用缩略图把清晰的原图盖回去。
          if (paintMaterial.map !== fallback) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 8;
          // 顺序不能反：必须先把新贴图挂上材质，再 dispose 被替换下来的占位图。
          // 反过来会让本帧（乃至 dispose 之后的任何同帧绘制）拿到已释放的 CanvasTexture，渲染出错。
          paintMaterial.map = texture;
          paintMaterial.needsUpdate = true;
          fallback.dispose();
        },
        undefined,
        // 缩略图失败就继续挂着占位图，等原图到达；这里不清空材质贴图。
        () => {},
      );
    }

    // 二级：原图这里不立即发起，只登记。等 setData() 里 8 幅画全部登记完，再按离相机的距离升序发。
    this.pendingFullLoads.push({
      work,
      material: paintMaterial,
      distance: placement.position.distanceTo(this.room.cameraStart),
      generation,
    });

    const frameStyle = this.getFrameStyle(work);
    const frameScale = Math.max(0.028, Math.min(0.1, width * 0.026));
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(width + frameScale * 0.8, height + frameScale * 0.8, 0.045),
      createSurfaceMaterial({ color: frameStyle.backColor, roughness: 0.68, metalness: 0.015 }),
    );
    backing.position.z = -0.035;
    backing.receiveShadow = true;

    const outerGap = frameStyle.outerGap ?? frameScale;
    const outerDepth = frameStyle.outerDepth ?? frameScale * 0.72;
    const outer = new THREE.Mesh(
      new THREE.BoxGeometry(width + outerGap * 2, height + outerGap * 2, outerDepth),
      createSurfaceMaterial({
        color: frameStyle.outerColor ?? 0xffffff,
        map: frameStyle.outerTexture,
        roughness: frameStyle.roughness ?? 0.42,
        metalness: frameStyle.metalness ?? 0.18,
        clearcoat: frameStyle.clearcoat ?? 0.08,
      }),
    );
    outer.position.z = -0.055;
    outer.castShadow = true;
    outer.receiveShadow = true;
    outer.name = 'artwork-frame';

    let inner = null;
    if (frameStyle.innerTexture) {
      const innerGap = frameStyle.innerGap ?? Math.max(0.008, outerGap * 0.45);
      const innerDepth = frameStyle.innerDepth ?? Math.max(0.018, outerDepth * 0.72);
      inner = new THREE.Mesh(
        new THREE.BoxGeometry(width + innerGap * 2, height + innerGap * 2, innerDepth),
        createSurfaceMaterial({
          color: frameStyle.innerColor ?? 0xffffff,
          map: frameStyle.innerTexture,
          roughness: frameStyle.innerRoughness ?? frameStyle.roughness ?? 0.42,
          metalness: frameStyle.innerMetalness ?? frameStyle.metalness ?? 0.16,
          clearcoat: frameStyle.clearcoat ?? 0.08,
        }),
      );
      inner.position.z = -0.045;
      inner.castShadow = true;
      inner.receiveShadow = true;
    }

    paintPlane.position.z = (frameStyle.paintDepth ?? outerDepth / 2) + 0.018;

    const artist = artists.find((item) => item.id === work.artistId);
    const labelElement = document.createElement('div');
    labelElement.className = 'artwork-label';
    const labelTitle = document.createElement('strong');
    const labelArtist = document.createElement('span');
    labelElement.append(labelTitle, labelArtist);
    const label = new CSS2DObject(labelElement);
    label.position.set(0, -height / 2 - 0.34, Math.max(0.08, outerDepth / 2 + 0.08));
    const labelEntry = { id: work.id, label, titleEl: labelTitle, artistEl: labelArtist, work, artist };
    this.applyLabelText(labelEntry);
    this.labelObjects.push(labelEntry);

    const frameParts = [backing, outer];
    if (inner) frameParts.push(inner);
    if (frameStyle.cornerAccents) {
      const cornerMat = createSurfaceMaterial({
        color: 0xffffff,
        map: frameStyle.outerTexture || makeGildedTexture(),
        roughness: 0.3,
        metalness: 0.38,
        clearcoat: 0.25,
      });
      const accentSize = Math.min(0.24, Math.max(0.07, (width + height) * 0.018));
      for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const accent = new THREE.Mesh(new THREE.SphereGeometry(accentSize, 12, 10), cornerMat);
        accent.position.set(sx * (width / 2 + outerGap * 0.32), sy * (height / 2 + outerGap * 0.32), -0.055);
        accent.castShadow = true;
        frameParts.push(accent);
      }
    }

    group.add(...frameParts, paintPlane, label);
    group.userData.artworkId = work.id;
    this.canvasMeshes.push(paintPlane);

    group.position.copy(placement.position);
    if (placement.normal) {
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), placement.normal);
    } else {
      group.lookAt(placement.lookAt);
    }

    const topLimit = this.room.height - height / 2 - 0.6;
    const bottomLimit = height / 2 + 0.58;
    group.position.y = THREE.MathUtils.clamp(group.position.y, bottomLimit, topLimit);
    this.addArtworkLighting(group, placement, width, height);
    return group;
  }

  // 二级：原图（单张 71–374 KB）。由 setData() 排序后按序调用。
  loadFullImage(work, paintMaterial, generation) {
    this.loader.load(
      work.image,
      (texture) => {
        if (generation !== this.loadGeneration) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        // 不再设 minFilter = LinearFilter：原图 1600px 在屏幕上基本是缩小显示，
        // 关掉 mipmap 会让远处/斜视的画出现闪烁与摩尔纹，交给 three 的默认 mipmap 过滤。
        // 顺序不能反：先换 map，再 dispose 被替换下来的那张（缩略图，或缩略图缺席/失败时的占位图）。
        const previous = paintMaterial.map;
        paintMaterial.map = texture;
        paintMaterial.needsUpdate = true;
        if (previous && previous !== texture) previous.dispose();
      },
      undefined,
      // 原图失败时保留当前贴图（缩略图或占位图），不清空材质——空贴图会渲染成整块白板。
      () => {},
    );
  }

  addArtworkLighting(group, placement, width, height) {
    const normal = placement.normal || new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(normal, up).normalize();
    const center = group.position.clone();
    const targetCenter = center.clone();
    const targetLeft = center.clone().addScaledVector(right, width * 0.18);
    const targetRight = center.clone().addScaledVector(right, -(width * 0.18));
    const spotlight = this.room.spotlight || {};
    const topColor = spotlight.topColor || '#ead8b2';
    const sideColor = spotlight.sideColor || '#dce4e2';
    const intensity = Math.min(Math.max(spotlight.intensity ?? 48, 38), 58);
    const sideIntensity = Math.min(Math.max(spotlight.sideIntensity ?? 9, 8), 10);
    const angle = Math.max(spotlight.angle ?? 0.88, 0.72);
    const sideAngle = Math.max(spotlight.sideAngle ?? 0.5, 0.5);
    const penumbra = Math.max(spotlight.penumbra ?? 0.98, 0.95);
    const sidePenumbra = Math.max(spotlight.sidePenumbra ?? 0.92, 0.92);
    const distance = Math.max(spotlight.distance ?? 28, 28);
    const decay = Math.min(Math.max(spotlight.decay ?? 1.2, 1.15), 1.25);

    const lights = [
      {
        color: topColor,
        intensity,
        angle,
        position: center.clone()
          .addScaledVector(normal, Math.max(3.2, width * 0.85))
          .add(new THREE.Vector3(0, height / 2 + 1.8, 0)),
        target: targetCenter,
        fixture: true,
      },
      {
        color: sideColor,
        intensity: sideIntensity,
        angle: sideAngle,
        penumbra: sidePenumbra,
        position: center.clone()
          .addScaledVector(normal, Math.max(2.0, width * 0.46))
          .addScaledVector(right, width * 0.55 + 1.0)
          .add(new THREE.Vector3(0, 0.28, 0)),
        target: targetLeft,
        fixture: false,
      },
      {
        color: sideColor,
        intensity: sideIntensity,
        angle: sideAngle,
        penumbra: sidePenumbra,
        position: center.clone()
          .addScaledVector(normal, Math.max(2.0, width * 0.46))
          .addScaledVector(right, -(width * 0.55 + 1.0))
          .add(new THREE.Vector3(0, 0.28, 0)),
        target: targetRight,
        fixture: false,
      },
    ];

    for (const definition of lights) {
      const target = new THREE.Object3D();
      target.position.copy(definition.target);
      this.scene.add(target);
      this.spotTargets.push(target);

      const light = new THREE.SpotLight(
        definition.color,
        definition.intensity,
        distance,
        definition.angle,
        definition.penumbra ?? penumbra,
        decay,
      );
      light.position.copy(definition.position);
      light.target = target;
      light.castShadow = false;
      this.artGroup.add(light);

      if (definition.fixture) {
        const housing = new THREE.Group();
        const housingMaterial = createSurfaceMaterial({
          color: 0x34383a,
          roughness: 0.34,
          metalness: 0.72,
          clearcoat: 0.08,
        });
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 16), housingMaterial);
        shell.position.z = -0.02;
        shell.castShadow = true;
        shell.receiveShadow = true;
        const lens = new THREE.Mesh(
          new THREE.CylinderGeometry(0.105, 0.105, 0.025, 16),
          new THREE.MeshStandardMaterial({ color: '#e5d3a7', emissive: '#c9ac75', emissiveIntensity: 0.45, roughness: 0.38, metalness: 0 }),
        );
        lens.position.z = 0.085;
        housing.add(shell, lens);
        housing.position.copy(definition.position);
        housing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3().subVectors(definition.target, definition.position).normalize());
        this.artGroup.add(housing);
      }
    }
  }

  getFrameStyle(work) {
    const style = {
      backColor: 0x29251f,
      outerColor: 0xffffff,
      outerTexture: makeWoodFloorTexture('#6e563f', '#4c3829', 256),
      innerTexture: null,
      roughness: 0.42,
      metalness: 0.14,
      clearcoat: 0.08,
      innerRoughness: 0.42,
      innerMetalness: 0.12,
      cornerAccents: false,
      outerGap: 0.16,
      outerDepth: 0.075,
      innerGap: 0.06,
      innerDepth: 0.055,
      paintDepth: 0.04,
    };
    switch (work.periodId) {
      case 'ancient-medieval':
        style.backColor = 0x3a3028;
        style.outerColor = 0xa89985;
        style.outerTexture = makeNoiseTexture('#a89985', '#77695a', 256, 0.06);
        style.roughness = 0.82;
        style.metalness = 0.015;
        style.clearcoat = 0.015;
        style.outerGap = 0.16;
        style.outerDepth = 0.1;
        break;
      case 'early-renaissance':
      case 'high-renaissance':
        style.backColor = 0x241f19;
        style.outerColor = 0xffffff;
        style.outerTexture = makeMarbleTexture('#d9d2c4', '#a89b87', 256);
        style.innerTexture = makeGildedTexture();
        style.roughness = 0.32;
        style.metalness = 0.08;
        style.clearcoat = 0.2;
        style.cornerAccents = work.periodId === 'high-renaissance';
        break;
      case 'baroque':
        style.backColor = 0x211814;
        style.outerTexture = makeGildedTexture();
        style.innerTexture = makeGildedTexture();
        style.roughness = 0.27;
        style.metalness = 0.42;
        style.clearcoat = 0.28;
        style.cornerAccents = true;
        style.outerGap = 0.2;
        style.outerDepth = 0.095;
        style.innerGap = 0.08;
        style.innerDepth = 0.07;
        break;
      case 'rococo-neoclassicism':
        style.backColor = 0x2b211a;
        style.outerColor = 0xf0e5cf;
        style.outerTexture = makeGildedTexture();
        style.innerTexture = makeGildedTexture();
        style.roughness = 0.29;
        style.metalness = 0.3;
        style.clearcoat = 0.22;
        style.outerGap = 0.12;
        style.outerDepth = 0.065;
        break;
      case 'romanticism':
      case 'realism':
        style.backColor = 0x241e18;
        style.outerColor = 0xffffff;
        style.outerTexture = makeWoodFloorTexture('#60462f', '#3e2b1e', 256);
        style.innerTexture = makeGildedTexture();
        style.roughness = 0.35;
        style.metalness = 0.08;
        style.clearcoat = 0.1;
        style.outerGap = 0.12;
        style.outerDepth = 0.06;
        break;
      case 'impressionism':
        style.backColor = 0xe8e4dc;
        style.outerColor = 0xffffff;
        style.outerTexture = makeSteelTexture();
        style.roughness = 0.25;
        style.metalness = 0.68;
        style.clearcoat = 0.16;
        style.outerGap = 0.055;
        style.outerDepth = 0.025;
        style.innerGap = 0.018;
        style.innerDepth = 0.02;
        style.paintDepth = 0.018;
        break;
      case 'post-impressionism':
        style.backColor = 0x29251f;
        style.outerColor = 0xffffff;
        style.outerTexture = makeWoodFloorTexture('#8b6d48', '#5d452d', 256);
        style.roughness = 0.36;
        style.metalness = 0.06;
        style.clearcoat = 0.12;
        style.outerGap = 0.09;
        style.outerDepth = 0.05;
        break;
      case 'modern-avant-garde':
        style.backColor = 0xf0eee9;
        style.outerColor = 0xffffff;
        style.outerTexture = makeSteelTexture();
        style.roughness = 0.2;
        style.metalness = 0.78;
        style.clearcoat = 0.18;
        style.outerGap = 0.025;
        style.outerDepth = 0.018;
        style.innerGap = 0.012;
        style.innerDepth = 0.015;
        style.paintDepth = 0.012;
        break;
      case 'expressionism-beyond':
        style.backColor = 0x1e2025;
        style.outerColor = 0xffffff;
        style.outerTexture = makeNoiseTexture('#6c6460', '#443f3d', 256, 0.06);
        style.roughness = 0.46;
        style.metalness = 0.1;
        style.clearcoat = 0.1;
        style.outerGap = 0.07;
        style.outerDepth = 0.042;
        break;
      case 'american-modern':
        style.backColor = 0xded9d2;
        style.outerTexture = makeSteelTexture();
        style.roughness = 0.22;
        style.metalness = 0.72;
        style.clearcoat = 0.16;
        style.outerGap = 0.055;
        style.outerDepth = 0.025;
        style.paintDepth = 0.015;
        break;
      default:
        break;
    }
    return style;
  }

  setRoom(periodId) {
    this.clearRoom();
    this.room = buildPeriodRoom(periodId);
    this.scene.add(this.room.group);
    this.scene.background = new THREE.Color(this.room.background);
    this.scene.fog = new THREE.FogExp2(this.room.fogColor, this.room.fogDensity);
    this.controls.setBounds(this.room.bounds, this.room.height);
  }

  clearRoom() {
    if (!this.room) return;
    this.scene.remove(this.room.group);
    this.room.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((mat) => {
          if (mat.map) mat.map.dispose();
          mat.dispose();
        });
      }
    });
    this.room = null;
  }

  getAspect(work) {
    const physicalWidth = Number(work.physicalWidthCm);
    const physicalHeight = Number(work.physicalHeightCm);
    if (physicalWidth > 0 && physicalHeight > 0) return physicalWidth / physicalHeight;
    if (work.imageWidth && work.imageHeight) return work.imageWidth / work.imageHeight;
    if (work.originalWidth && work.originalHeight) return work.originalWidth / work.originalHeight;
    return 1.25;
  }

  getArtworkTransforms() {
    return this.canvasMeshes.map((mesh) => {
      const position = new THREE.Vector3();
      const normal = new THREE.Vector3();
      mesh.getWorldPosition(position);
      mesh.getWorldDirection(normal);
      return {
        id: this.findArtworkId(mesh),
        position: { x: position.x, y: position.y, z: position.z },
        normal: { x: normal.x, y: normal.y, z: normal.z },
      };
    });
  }

  // 调试接缝（只在 ?smoke=1 的页面里被调用，见 src/main.js）：把相机正对某幅画，便于自动化点击/轻点它。
  aimAtArtwork(artworkId) {
    if (!this.camera || !this.controls) return false;
    const mesh = this.canvasMeshes.find((item) => this.findArtworkId(item) === artworkId);
    if (!mesh) return false;
    const target = new THREE.Vector3();
    mesh.getWorldPosition(target);
    this.controls.setInitial(this.camera.position, target);
    this.tick();
    return true;
  }

  getArtworkOcclusion() {
    const results = [];
    for (const mesh of this.canvasMeshes) {
      const position = new THREE.Vector3();
      mesh.getWorldPosition(position);
      const direction = new THREE.Vector3().subVectors(position, this.camera.position).normalize();
      const ray = new THREE.Raycaster(this.camera.position, direction);
      const hits = ray.intersectObjects(this.scene.children, true);
      const first = hits[0];
      const id = this.findArtworkId(mesh);
      results.push({
        id,
        occluded: !first || this.findArtworkId(first.object) !== id,
        hitType: first?.object?.type || null,
        hitName: first?.object?.name || null,
        hitPosition: first?.object ? {
          x: Number(first.object.position.x.toFixed(2)),
          y: Number(first.object.position.y.toFixed(2)),
          z: Number(first.object.position.z.toFixed(2)),
        } : null,
        distance: first ? Number(first.distance.toFixed(2)) : null,
      });
    }
    return results;
  }

  clearArtGroup() {
    if (this.artGroup) {
      this.scene.remove(this.artGroup);
      this.artGroup.traverse((obj) => {
        if (obj.isCSS2DObject && obj.element?.remove) obj.element.remove();
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach((mat) => {
            if (mat.map) mat.map.dispose();
            mat.dispose();
          });
        }
      });
    }
    this.artGroup = null;
    this.canvasMeshes = [];
    this.labelObjects = [];
    this.loadGeneration += 1;
    // 上一代尚未发起的原图加载一并作废：留着它们会在切房间后被发出去抢带宽。
    this.pendingFullLoads = [];
    for (const target of this.spotTargets) this.scene.remove(target);
    this.spotTargets = [];
  }

  onCanvasClick(event) {
    // A touch tap already opened the artwork in onCanvasPointerUp, and the browser
    // still synthesises a click afterwards: swallow that echo instead of locking.
    if (performance.now() < this.ignoreClickUntil) return;
    if (document.pointerLockElement !== this.renderer.domElement) {
      this.controls.requestLock();
      return;
    }
    this.pickArtworkAt(event.clientX, event.clientY);
  }

  onCanvasPointerDown(event) {
    if (event.pointerType !== 'touch') return;
    this.touchGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }

  onCanvasPointerMove(event) {
    const gesture = this.touchGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const travelled = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (travelled > TAP_MOVE_LIMIT) gesture.moved = true;
  }

  onCanvasPointerUp(event) {
    const gesture = this.touchGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.touchGesture = null;
    this.ignoreClickUntil = performance.now() + CLICK_SUPPRESS_MS;
    if (gesture.moved) return;
    this.pickArtworkAt(event.clientX, event.clientY);
  }

  onCanvasPointerCancel(event) {
    const gesture = this.touchGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.touchGesture = null;
    this.ignoreClickUntil = performance.now() + CLICK_SUPPRESS_MS;
  }

  pickArtworkAt(clientX, clientY) {
    if (!this.renderer || !this.camera || !this.canvasMeshes.length) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.canvasMeshes, false);
    if (!hits.length) return false;
    const id = this.findArtworkId(hits[0].object);
    if (!id || !this.artworkClick) return false;
    this.artworkClick(id);
    return true;
  }

  buildTouchControls() {
    const wrapper = document.createElement('div');
    wrapper.className = 'gallery-touch-controls';
    wrapper.innerHTML = `
      <div class="touch-joystick">
        <div class="touch-joystick-ring"></div>
        <div class="touch-joystick-knob"></div>
      </div>
      <div class="touch-joystick-caption">${t('gallery.joystickCaption')}</div>
    `;
    this.el.appendChild(wrapper);
    this.touchControls = wrapper;
    this.joystick = wrapper.querySelector('.touch-joystick');
    this.joystickKnob = wrapper.querySelector('.touch-joystick-knob');
    this.joystick.addEventListener('pointerdown', this.onJoystickDown);
    window.addEventListener('pointermove', this.onJoystickMove, { passive: false });
    window.addEventListener('pointerup', this.onJoystickEnd);
    window.addEventListener('pointercancel', this.onJoystickEnd);
  }

  onJoystickDown(event) {
    if (this.joystickPointerId !== null) return;
    this.joystickPointerId = event.pointerId;
    this.joystickRect = this.joystick.getBoundingClientRect();
    this.joystick.classList.add('is-engaged');
    if (event.cancelable) event.preventDefault();
    this.applyJoystick(event.clientX, event.clientY);
  }

  onJoystickMove(event) {
    if (this.joystickPointerId === null || event.pointerId !== this.joystickPointerId) return;
    if (event.cancelable) event.preventDefault();
    this.applyJoystick(event.clientX, event.clientY);
  }

  onJoystickEnd(event) {
    if (this.joystickPointerId === null || event.pointerId !== this.joystickPointerId) return;
    this.resetJoystick();
  }

  applyJoystick(clientX, clientY) {
    if (!this.joystick || !this.controls) return;
    const rect = this.joystickRect || this.joystick.getBoundingClientRect();
    const knobSize = this.joystickKnob ? this.joystickKnob.offsetWidth : 56;
    const radius = Math.max(24, rect.width / 2 - knobSize / 2 - 2);
    let offsetX = clientX - (rect.left + rect.width / 2);
    let offsetY = clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(offsetX, offsetY);
    if (distance > radius) {
      offsetX = (offsetX / distance) * radius;
      offsetY = (offsetY / distance) * radius;
    }
    if (this.joystickKnob) {
      this.joystickKnob.style.transform = `translate(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px)`;
    }
    const normalizedX = offsetX / radius;
    const normalizedY = offsetY / radius;
    const magnitude = Math.hypot(normalizedX, normalizedY);
    const gain = magnitude <= JOYSTICK_DEAD_ZONE
      ? 0
      : (magnitude - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE) / magnitude;
    this.controls.setMoveVector(normalizedX * gain, -normalizedY * gain);
  }

  resetJoystick() {
    this.joystickPointerId = null;
    this.joystickRect = null;
    if (this.joystick) this.joystick.classList.remove('is-engaged');
    if (this.joystickKnob) this.joystickKnob.style.transform = 'translate(0px, 0px)';
    this.controls?.setMoveVector(0, 0);
  }

  disposeTouchControls() {
    if (!this.touchControls) return;
    window.removeEventListener('pointermove', this.onJoystickMove);
    window.removeEventListener('pointerup', this.onJoystickEnd);
    window.removeEventListener('pointercancel', this.onJoystickEnd);
    this.joystick?.removeEventListener('pointerdown', this.onJoystickDown);
    this.touchControls.remove();
    this.touchControls = null;
    this.joystick = null;
    this.joystickKnob = null;
    this.joystickPointerId = null;
    this.joystickRect = null;
    this.controls?.setMoveVector(0, 0);
  }

  findArtworkId(object) {
    let current = object;
    while (current) {
      if (current.userData && current.userData.artworkId) return current.userData.artworkId;
      current = current.parent;
    }
    return null;
  }

  setLocked(locked) {
    if (!this.el) return;
    this.el.classList.toggle('is-locked', locked);
  }

  onArtworkClick(callback) {
    this.artworkClick = callback;
  }

  show(manifest, periodId) {
    this.el.hidden = false;
    this.visible = true;
    this.setData(manifest, periodId);
    this.onResize();
    this.renderer.setAnimationLoop(this.tick);
  }

  hide() {
    if (!this.el) return;
    this.visible = false;
    this.el.hidden = true;
    if (this.renderer) this.renderer.setAnimationLoop(null);
    if (this.controls) this.controls.exitLock();
    this.resetJoystick();
  }

  exitPointerLock() {
    this.controls?.exitLock();
  }

  onResize() {
    if (!this.renderer || !this.camera || !this.composer) return;
    const host = this.el.querySelector('.gallery-canvas');
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    if (this.labelRenderer) this.labelRenderer.setSize(width, height);
  }

  tick = () => {
    this.timer.update();
    const delta = this.timer.getDelta();
    if (this.controls) this.controls.update(delta);
    this.updateLabelOcclusion();
    if (this.composer) this.composer.render();
    if (this.labelRenderer) this.labelRenderer.render(this.scene, this.camera);
    // 去压盖必须在 CSS2DRenderer 渲染之后：渲染器才把标签摆到本帧的屏幕位置，
    // 若提前量测，读到的是上一帧坐标，判定会在两帧之间来回摆动（实测单块标签
    // 逐帧切换多达 10 次）。
    this.resolveLabelCollisions();
    this.trackFrameTime(delta);
  };

  updateLabelOcclusion() {
    if (!this.labelObjects.length) return;
    const occlusion = new Map(this.getArtworkOcclusion().map((item) => [item.id, item.occluded]));
    // 时间滞回：遮挡判定是逐帧射线检测，相机缓慢平移时射线会掠过柱子/墙缘，
    // 使画作在「被遮挡 / 未被遮挡」之间逐帧翻转（实测单块标签 81 帧内抖动 13 次，
    // 且该抖动与本文件的标签排版逻辑无关——关掉去压盖后抖动依旧）。
    // 要求连续若干帧都被判定为遮挡才隐藏，消除边缘掠过造成的单帧闪烁；
    // 恢复可见立即生效，避免说明牌长时间不出现。
    const HIDE_AFTER_FRAMES = 6;
    if (!this.labelOccludedStreak) this.labelOccludedStreak = new Map();
    for (const item of this.labelObjects) {
      const occluded = occlusion.get(item.id) === true;
      const streak = occluded ? (this.labelOccludedStreak.get(item.id) || 0) + 1 : 0;
      this.labelOccludedStreak.set(item.id, streak);
      const hidden = occluded && streak >= HIDE_AFTER_FRAMES;
      item.label.element.style.visibility = hidden ? 'hidden' : 'visible';
    }
  }

  // 标签互相压盖的消解。
  //
  // 墙上标签是 CSS2D：尺寸由 CSS 决定、位置由画作投影决定，两者互不知情。
  // 同一面墙的画作在屏幕上靠得近时标签会盖住彼此文字；实测中文最长 290px、
  // 英文最长 477px，英文更重（6 对压盖，最大 154x34px 真的遮字）。
  //
  // 做法：按「离相机近的优先」贪心保留，重叠则隐藏较远的那块。走近某幅画时
  // 它附近的标签自然变少，标题就显出来——符合展厅里走近才看清说明牌的直觉。
  //
  // 双阈值滞回（关键）：重叠判定若用单一阈值，标签会在临界点随相机连续移动
  // 反复进出，实测单块标签在慢速平移中切换 10 次以上、出现单帧抖动。这里用
  // 「进入需完全让开、退出需明显压住」的非对称阈值，中间留出死区保持原状。
  resolveLabelCollisions() {
    if (this.labelObjects.length < 2) return;
    // 非对称滞回：
    //   已经可见的标签，要被压住超过 EXIT_PX 才让位；
    //   已经隐藏的标签，要与所有已保留标签拉开 REENTER_PX 以上的净空才恢复。
    // 二者之间是死区，保持上一帧状态。若「恢复」门槛设得小（曾试 3px），
    // 隐藏块中间会冒出单帧可见的闪光；实测把它改成要求净空后消失。
    const EXIT_PX = 10;
    const REENTER_PX = 8;
    const BIAS = 0.8; // 世界单位：上一帧保留者享有微弱优先，抑制排序抖动
    if (!this.labelKeptIds) this.labelKeptIds = new Set();

    const candidates = [];
    const worldPosition = new THREE.Vector3();
    for (const item of this.labelObjects) {
      const element = item.label.element;
      if (element.style.visibility === 'hidden') continue;
      item.label.getWorldPosition(worldPosition);
      const distance = worldPosition.distanceTo(this.camera.position);
      const wasKept = this.labelKeptIds.has(item.id);
      candidates.push({ element, id: item.id, wasKept, effective: wasKept ? distance - BIAS : distance });
    }
    if (candidates.length < 2) {
      this.labelKeptIds = new Set(candidates.map((c) => c.id));
      return;
    }

    candidates.sort((a, b) => a.effective - b.effective);

    const keptRects = [];
    const keptIds = new Set();
    for (const candidate of candidates) {
      const rect = candidate.element.getBoundingClientRect();
      // 尚未完成布局（0 尺寸）时不做判定，避免误隐藏
      if (rect.width === 0 && rect.height === 0) {
        keptRects.push(rect);
        keptIds.add(candidate.id);
        continue;
      }
      // 与已保留标签的关系：deepest = 最大穿透深度；separation = 最大净空（负值表示有重叠）
      let deepest = 0;
      let separation = Number.POSITIVE_INFINITY;
      for (const other of keptRects) {
        const overlapW = Math.min(rect.right, other.right) - Math.max(rect.left, other.left);
        const overlapH = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top);
        if (overlapW > 0 && overlapH > 0) {
          deepest = Math.max(deepest, Math.min(overlapW, overlapH));
        } else {
          // 未重叠：两轴各自需要让开的距离，取较大者作为净空
          separation = Math.min(separation, Math.max(-overlapW, -overlapH));
        }
      }
      const collides = candidate.wasKept
        ? deepest > EXIT_PX
        : (deepest > 0 || separation < REENTER_PX);
      candidate.element.style.visibility = collides ? 'hidden' : 'visible';
      if (!collides) {
        keptRects.push(rect);
        keptIds.add(candidate.id);
      }
    }
    this.labelKeptIds = keptIds;
  }

  dispose() {
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
      this.renderer.domElement.removeEventListener('pointerdown', this.onCanvasPointerDown);
      this.renderer.domElement.removeEventListener('pointermove', this.onCanvasPointerMove);
      this.renderer.domElement.removeEventListener('pointerup', this.onCanvasPointerUp);
      this.renderer.domElement.removeEventListener('pointercancel', this.onCanvasPointerCancel);
      window.removeEventListener('resize', this.onResize);
      this.controls?.dispose();
      this.timer?.disconnect();
      this.clearArtGroup();
      this.clearRoom();
      if (this.labelRenderer) {
        this.labelRenderer.domElement.remove();
        this.labelRenderer = null;
      }
      this.renderer.dispose();
      this.renderer = null;
    }
    this.disposeTouchControls();
    this.frameSamples = [];
    this.touchGesture = null;
    this.langToggle = null;
    this.manifest = null;
    if (this.el) this.el.remove();
    this.el = null;
  }
}
