import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
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
    this.pixelRatioLadder = [DESKTOP_PIXEL_RATIO_CAP];
    this.pixelRatioIndex = 0;
    this.frameSamples = [];
    this.loader = new THREE.TextureLoader();
    this.loadGeneration = 0;
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
    const device = detectDevice();
    this.isTouch = device.isTouch;
    this.lowPower = device.lowPower;
    this.setupQualityLadder();
    this.el = document.createElement('div');
    this.el.className = this.isTouch ? 'gallery-root is-touch' : 'gallery-root';
    this.el.innerHTML = `
      <div class="gallery-canvas"></div>
      <div class="gallery-hud">
        <button class="secondary-button gallery-back" type="button">返回时间轴</button>
        <div class="gallery-period"></div>
        <div class="gallery-controls-hint">${this.isTouch
          ? '拖动旋转视角 · 点击画作查看详情'
          : 'WASD / 方向键移动 · 鼠标旋转 · E 查看 · Esc 退出'}</div>
      </div>
      <div class="pointer-hint">
        <strong>点击画面进入第一人称</strong>
        <span>A / ← 向左 · D / → 向右</span>
      </div>
    `;
    this.container.appendChild(this.el);
    this.el.querySelector('.gallery-back').addEventListener('click', () => this.onBack());

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
    this.setRoom(periodId);
    this.clearArtGroup();
    this.artGroup = new THREE.Group();
    this.artGroup.name = 'artwork-group';
    this.scene.add(this.artGroup);

    const period = manifest.periods.find((item) => item.id === periodId);
    const works = manifest.artworks.filter((item) => item.periodId === periodId);
    this.currentPeriodId = periodId;
    this.canvasMeshes = [];
    this.labelObjects = [];

    const periodEl = this.el.querySelector('.gallery-period');
    periodEl.textContent = period ? `${period.name} · ${period.range}` : '';

    works.forEach((work, index) => {
      const frameGroup = this.createFrame(work, works, index, manifest.artists);
      this.artGroup.add(frameGroup);
    });

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
    const fallback = makeFallbackTexture(work.title);
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
    this.loader.load(
      work.image,
      (texture) => {
        if (generation !== this.loadGeneration) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        texture.minFilter = THREE.LinearFilter;
        paintMaterial.map = texture;
        paintMaterial.needsUpdate = true;
      },
      undefined,
      () => {},
    );

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
    labelTitle.textContent = work.title;
    const labelArtist = document.createElement('span');
    labelArtist.textContent = artist ? artist.name : '佚名';
    labelElement.append(labelTitle, labelArtist);
    const label = new CSS2DObject(labelElement);
    label.position.set(0, -height / 2 - 0.34, Math.max(0.08, outerDepth / 2 + 0.08));
    this.labelObjects.push({ id: work.id, label });

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

    const placement = this.room.getArtworkTransform(index, works.length, work);
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
      <div class="touch-joystick-caption">按住摇杆移动</div>
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
    this.trackFrameTime(delta);
  };

  updateLabelOcclusion() {
    if (!this.labelObjects.length) return;
    const occlusion = new Map(this.getArtworkOcclusion().map((item) => [item.id, item.occluded]));
    for (const item of this.labelObjects) {
      item.label.element.style.visibility = occlusion.get(item.id) ? 'hidden' : 'visible';
    }
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
    if (this.el) this.el.remove();
    this.el = null;
  }
}
