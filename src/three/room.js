import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import {
  createSurfaceMaterial,
  makeCofferTexture,
  makeNoiseTexture,
  makeWoodFloorTexture,
} from './materials.js';

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const WHITE = 0xffffff;

function surface(color, options = {}) {
  return createSurfaceMaterial({
    color,
    map: options.map || null,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.015,
    clearcoat: options.clearcoat ?? 0.035,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.72,
    sheen: options.sheen ?? 0,
    sheenColor: options.sheenColor ?? WHITE,
    side: options.side ?? THREE.FrontSide,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
}

function addMesh(group, geometry, material, position = [0, 0, 0], rotation = null, options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) {
    mesh.rotation.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0);
  }
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  group.add(mesh);
  return mesh;
}

function addWall(group, length, height, x, z, normal, material, options = {}) {
  const mesh = addMesh(
    group,
    new THREE.PlaneGeometry(length, height),
    material,
    [x + normal.x * 0.22, height / 2, z + normal.z * 0.22],
    null,
    options,
  );
  mesh.name = 'wall';
  mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
  return mesh;
}

function addFloor(group, width, depth, material, x = 0, z = 0, y = 0) {
  const mesh = addMesh(
    group,
    new THREE.PlaneGeometry(width, depth),
    material,
    [x, y, z],
    [-Math.PI / 2, 0, 0],
    { castShadow: false, receiveShadow: true },
  );
  mesh.name = 'floor';
  return mesh;
}

function addCeiling(group, width, depth, material, x = 0, z = 0, y = 0) {
  const mesh = addMesh(
    group,
    new THREE.PlaneGeometry(width, depth),
    material,
    [x, y, z],
    [Math.PI / 2, 0, 0],
    { castShadow: false, receiveShadow: true },
  );
  mesh.name = 'ceiling';
  return mesh;
}

function addRectRoom(group, {
  cx = 0,
  cz = 0,
  width,
  depth,
  height,
  wallMat,
  floorMat,
  ceilingMat = null,
  openSides = [],
  addRoof = true,
}) {
  addFloor(group, width, depth, floorMat, cx, cz, 0.01);
  if (!openSides.includes('north')) {
    addWall(group, width, height, cx, cz - depth / 2, new THREE.Vector3(0, 0, 1), wallMat);
  }
  if (!openSides.includes('south')) {
    addWall(group, width, height, cx, cz + depth / 2, new THREE.Vector3(0, 0, -1), wallMat);
  }
  if (!openSides.includes('west')) {
    addWall(group, depth, height, cx - width / 2, cz, new THREE.Vector3(1, 0, 0), wallMat);
  }
  if (!openSides.includes('east')) {
    addWall(group, depth, height, cx + width / 2, cz, new THREE.Vector3(-1, 0, 0), wallMat);
  }
  if (addRoof && ceilingMat) {
    addCeiling(group, width, depth, ceilingMat, cx, cz, height);
  }
  return { cx, cz, width, depth, height };
}

function addReflectiveFloor(group, width, depth, color = 0xd8d2c8, y = 0.015) {
  const floor = new Reflector(new THREE.PlaneGeometry(width, depth), {
    color,
    clipBias: 0.003,
    textureWidth: 768,
    textureHeight: 768,
  });
  floor.name = 'reflective-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  floor.receiveShadow = true;
  group.add(floor);
  return floor;
}

function addDomeShell(group, radius, height, material, side = THREE.BackSide) {
  const dome = addMesh(
    group,
    new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
    material,
    [0, 0, 0],
    null,
    { castShadow: false, receiveShadow: true },
  );
  dome.name = 'dome';
  dome.scale.set(radius, height, radius);
  dome.material.side = side;
  return dome;
}

function addSkyDome(group, topColor = '#476f8b', midColor = '#8ca9b4', bottomColor = '#b6b0a5') {
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(topColor) },
      midColor: { value: new THREE.Color(midColor) },
      bottomColor: { value: new THREE.Color(bottomColor) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 color = mix(midColor, topColor, smoothstep(0.05, 0.65, h));
        color = mix(bottomColor, color, smoothstep(-0.35, 0.18, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 48, 24), skyMaterial);
  sky.position.y = 16;
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);
  return sky;
}

function addLightPanel(group, width, depth, y, color, intensity = 0.9) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.42,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  return addMesh(
    group,
    new THREE.PlaneGeometry(width, depth),
    mat,
    [0, y, 0],
    [Math.PI / 2, 0, 0],
    { castShadow: false, receiveShadow: true },
  );
}

function addBeams(group, width, depth, y, material, count = 7, beamHeight = 0.22, beamWidth = 0.16) {
  for (let i = 0; i < count; i += 1) {
    const x = (i / Math.max(1, count - 1) - 0.5) * width * 0.88;
    addMesh(group, new THREE.BoxGeometry(beamWidth, beamHeight, depth * 0.94), material, [x, y, 0]);
  }
}

function addPilasters(group, length, height, center, normal, material, count = 4, depth = 0.16) {
  const tangent = new THREE.Vector3(normal.z, 0, -normal.x).normalize();
  for (let i = 0; i < count; i += 1) {
    const t = (i / Math.max(1, count - 1) - 0.5) * length * 0.76;
    const x = center.x + tangent.x * t;
    const z = center.z + tangent.z * t;
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, height * 0.96, depth),
      material,
      [x + normal.x * 0.08, height / 2, z + normal.z * 0.08],
    );
  }
}

function addBand(group, length, y, center, normal, material, width = 0.16, depth = 0.18) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length * 0.94, width, depth), material);
  mesh.position.set(center.x, y, center.z);
  mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addVaultedCeiling(group, width, depth, height, material, ribMaterial = null, bands = 7) {
  addCeiling(group, width, depth, material, 0, 0, height);
  const rib = ribMaterial || material;
  for (let i = 0; i < bands; i += 1) {
    const x = (i / Math.max(1, bands - 1) - 0.5) * width * 0.84;
    addMesh(group, new THREE.BoxGeometry(0.16, 0.24, depth * 0.96), rib, [x, height + 0.04, 0]);
  }
}

function addPolygonalShell(group, radius, height, sides, wallMat, floorMat, ceilingMat = null) {
  // 地板用整圆（64 段）：CircleGeometry(radius, sides) 是内接多边形，边中点到墙面留约 0.92 的通缝，
  // 墙角处能直接看见背景。整圆边缘比墙面多出 0.22（落到墙外），从房内看不见。
  const floor = addMesh(group, new THREE.CircleGeometry(radius, 64), floorMat, [0, 0.01, 0], [-Math.PI / 2, 0, 0], { castShadow: false });
  floor.name = 'floor';
  const sideLength = radius * 2 * Math.sin(Math.PI / sides);
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const normal = new THREE.Vector3(-Math.sin(angle), 0, -Math.cos(angle)).normalize();
    addWall(group, sideLength, height, x, z, normal, wallMat);
  }
  if (ceilingMat) addCeiling(group, radius * 2, radius * 2, ceilingMat, 0, 0, height);
  return { radius, height, sides };
}

// thetaStart / thetaLength 用于在椭圆墙上留出缺口：整圈墙会把并排的矩形展厅封在外面，
// 只有让出一段圆周，两个空间才能连通。约定与 CylinderGeometry 一致（x = r·sinθ、z = r·cosθ，
// 故 +X 方向为 θ=π/2）。
function addOvalShell(group, rx, rz, height, wallMat, floorMat, ceilingMat = null, thetaStart = 0, thetaLength = Math.PI * 2) {
  // 椭圆盘（地板/天花）是 CircleGeometry：它躺在自身 XY 平面里，绕 X 转 ±90° 后局部 Y 变成世界 Z，
  // 所以水平盘的缩放必须是 (rx, rz, 1)。原来写成 (rx, 1, rz)（那是圆柱的缩放写法）只会得到
  // 2·rx × 2 的一条窄带——实测椭圆厅地板/天花各自只剩约 19×2，其余位置垂直下探全部打空，
  // 玩家往下看直接是背景。（圆柱本身仍用 (rx, 1, rz)：它的圆截面在局部 XZ 平面，写法是对的。）
  const floor = addMesh(group, new THREE.CircleGeometry(1, 64), floorMat, [0, 0.01, 0], [-Math.PI / 2, 0, 0], { castShadow: false });
  floor.scale.set(rx, rz, 1);
  floor.name = 'floor';
  // 圆筒法线朝外，材质默认 FrontSide：从厅内看内表面会被背面剔除，整圈墙根本不渲染
  // （实测厅内水平打 24 条射线有 21 条什么都没命中，其它房间是 24/24 命中墙）。
  // 这里为椭圆筒单独 clone 一个 BackSide 材质——该材质实例同时被矩形展厅的墙共用，不能就地翻面。
  const ovalWallMat = wallMat.clone();
  ovalWallMat.side = THREE.BackSide;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, height, 64, 1, true, thetaStart, thetaLength), ovalWallMat);
  wall.name = 'wall';
  wall.scale.set(rx, 1, rz);
  wall.position.y = height / 2;
  wall.receiveShadow = true;
  group.add(wall);
  if (ceilingMat) {
    const ceiling = addMesh(group, new THREE.CircleGeometry(1, 64), ceilingMat, [0, height, 0], [Math.PI / 2, 0, 0], { castShadow: false });
    ceiling.scale.set(rx, rz, 1);
    ceiling.name = 'ceiling';
  }
}

function addRoseWindow(group, x, z, y, radius, normal, color = '#bc7b68') {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.12, 12, 48),
    createSurfaceMaterial({ color: '#6c6257', roughness: 0.42, metalness: 0.08 }),
  );
  ring.position.set(x + normal.x * 0.08, y, z + normal.z * 0.08);
  ring.quaternion.setFromUnitVectors(Z_AXIS, normal);
  group.add(ring);
  const petals = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.88, 32),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2,
      roughness: 0.65,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.52,
    }),
  );
  petals.position.set(x + normal.x * 0.1, y, z + normal.z * 0.1);
  petals.quaternion.setFromUnitVectors(Z_AXIS, normal);
  group.add(petals);
}

function addGlassStrip(group, length, y, center, normal, color = '#9bb3ba', opacity = 0.32) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.18,
    roughness: 0.48,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, 1.2), mat);
  mesh.position.set(center.x + normal.x * 0.2, y, center.z + normal.z * 0.2);
  mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addBalustrade(group, length, center, normal, material, y = 0.02, height = 1.05) {
  const tangent = new THREE.Vector3(normal.z, 0, -normal.x).normalize();
  const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, 0.16), material);
  rail.position.set(center.x, y + height, center.z);
  rail.quaternion.setFromUnitVectors(Z_AXIS, normal);
  rail.castShadow = true;
  rail.receiveShadow = true;
  group.add(rail);
  for (let i = 0; i <= 8; i += 1) {
    const t = (i / 8 - 0.5) * length;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, height, 0.1), material);
    post.position.set(center.x + tangent.x * t, y + height / 2, center.z + tangent.z * t);
    post.quaternion.setFromUnitVectors(Z_AXIS, normal);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
  }
}

function bounds(minX, maxX, minZ, maxZ) {
  return { minX, maxX, minZ, maxZ };
}

function baseRoom(group, layout) {
  return {
    group,
    bounds: layout.bounds,
    background: layout.background || '#d5d2cb',
    fogColor: layout.fogColor || '#cfcbc4',
    fogDensity: layout.fogDensity ?? 0.0035,
    height: layout.height ?? 8,
    getArtworkTransform: layout.getArtworkTransform,
    cameraStart: layout.cameraStart || new THREE.Vector3(0, 2.7, 8),
    cameraLookAt: layout.cameraLookAt || new THREE.Vector3(0, 3, 0),
    spotlight: layout.spotlight || {
      topColor: '#ead8b2',
      sideColor: '#dce4e2',
      intensity: 28,
      sideIntensity: 12,
      angle: 0.42,
      sideAngle: 0.25,
      penumbra: 0.72,
      distance: 11,
      decay: 1.7,
    },
  };
}

function segmentPlacements(segments, y, count) {
  return (index) => {
    const segment = segments[index % segments.length];
    const perSegment = Math.max(1, Math.ceil(count / segments.length));
    const local = Math.floor(index / segments.length);
    const offset = (local + 1) / (perSegment + 1) - 0.5;
    const tangent = segment.axis || new THREE.Vector3(segment.normal.z, 0, -segment.normal.x).normalize();
    const x = segment.x + tangent.x * offset * segment.length;
    const z = segment.z + tangent.z * offset * segment.length;
    const wallOffset = segment.offset ?? 0.38;
    const position = new THREE.Vector3(x + segment.normal.x * wallOffset, segment.y ?? y, z + segment.normal.z * wallOffset);
    return {
      position,
      normal: segment.normal.clone(),
      lookAt: new THREE.Vector3(x, segment.y ?? y, z).addScaledVector(segment.normal, -4),
    };
  };
}

function polySegments(radius, sides, y = 2.8) {
  const sideLength = radius * 2 * Math.sin(Math.PI / sides);
  return Array.from({ length: sides }, (_, i) => {
    // 这里不能加 Math.PI / sides：addPolygonalShell 的墙面是方向为 i*2π/sides 的切平面，
    // 多这半个扇区会把布点推到两墙之间的角部——既贴不上任何一面墙（实测离墙 1.5 以上），
    // 画幅上半截又被穹顶壳盖住。去掉后布点方向与墙面法线一致。
    const angle = (i / sides) * Math.PI * 2;
    const normal = new THREE.Vector3(-Math.sin(angle), 0, -Math.cos(angle)).normalize();
    return {
      x: Math.sin(angle) * radius,
      z: Math.cos(angle) * radius,
      length: sideLength,
      y,
      normal,
      axis: new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)).normalize(),
    };
  });
}

function rectSegments(width, depth, y = 2.8, openSides = []) {
  const segments = [];
  if (!openSides.includes('north')) {
    segments.push({ x: 0, z: -depth / 2, length: width, y, normal: new THREE.Vector3(0, 0, 1), axis: new THREE.Vector3(1, 0, 0) });
  }
  if (!openSides.includes('south')) {
    segments.push({ x: 0, z: depth / 2, length: width, y, normal: new THREE.Vector3(0, 0, -1), axis: new THREE.Vector3(1, 0, 0) });
  }
  if (!openSides.includes('west')) {
    segments.push({ x: -width / 2, z: 0, length: depth, y, normal: new THREE.Vector3(1, 0, 0), axis: new THREE.Vector3(0, 0, 1) });
  }
  if (!openSides.includes('east')) {
    segments.push({ x: width / 2, z: 0, length: depth, y, normal: new THREE.Vector3(-1, 0, 0), axis: new THREE.Vector3(0, 0, 1) });
  }
  return segments;
}

function buildAncientMedieval() {
  const group = new THREE.Group();
  const width = 26;
  const depth = 32;
  const height = 8.4;
  const wall = surface('#b9afa2', { roughness: 0.72, clearcoat: 0.025 });
  const floor = surface('#a89679', { map: makeNoiseTexture('#a89679', '#8b7963', 512, 0.045), roughness: 0.31, clearcoat: 0.12 });
  const ceiling = surface('#c4bbad', { map: makeCofferTexture('#c4bbad', '#a49b8f', 512), roughness: 0.48, clearcoat: 0.05 });
  addRectRoom(group, { width, depth, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling });
  addVaultedCeiling(group, width, depth, height, ceiling, surface('#756b5d', { roughness: 0.6, metalness: 0.03 }), 9);
  const archMat = surface('#8f806e', { roughness: 0.54, clearcoat: 0.07 });
  for (let i = 0; i < 8; i += 1) {
    const z = -depth / 2 + (i / 7) * depth;
    const left = addMesh(group, new THREE.TorusGeometry(1.35, 0.14, 8, 32, Math.PI), archMat, [-width / 2 + 0.5, 3.7, z], [0, Math.PI / 2, 0]);
    const right = addMesh(group, new THREE.TorusGeometry(1.35, 0.14, 8, 32, Math.PI), archMat, [width / 2 - 0.5, 3.7, z], [0, -Math.PI / 2, 0]);
    left.castShadow = false;
    right.castShadow = false;
  }
  return baseRoom(group, {
    bounds: bounds(-width / 2 + 1.4, width / 2 - 1.4, -depth / 2 + 1.4, depth / 2 - 1.4),
    background: '#8a7e70',
    fogColor: '#999085',
    fogDensity: 0.0022,
    height,
    getArtworkTransform: segmentPlacements(rectSegments(width, depth, 2.8), 2.8, 8),
    cameraStart: new THREE.Vector3(0, 2.7, 8),
    cameraLookAt: new THREE.Vector3(0, 2.8, 0),
    spotlight: { topColor: '#e7c997', sideColor: '#d7d0bd', intensity: 30, sideIntensity: 13, angle: 0.42, sideAngle: 0.25, penumbra: 0.72, distance: 11, decay: 1.7 },
  });
}

function buildEarlyRenaissance() {
  const group = new THREE.Group();
  const height = 7.8;
  const wall = surface('#d5cfbf', { roughness: 0.66, clearcoat: 0.055 });
  const floor = surface('#a58b70', { map: makeWoodFloorTexture('#a58b70', '#80684f', 512), roughness: 0.31, clearcoat: 0.14 });
  const ceiling = surface('#d9d4c8', { map: makeNoiseTexture('#d9d4c8', '#c2baab', 512, 0.025), roughness: 0.5 });
  // 两间并排对齐，合成一条 x∈[-18,18]、z∈[-5,5] 的 36×10 通长画廊：接缝在 x=6，两翼各自开边，墙上无隔墙。
  // 旧布局第二个房间用 cz:6 / depth:14（x∈[-6,6]、z∈[-1,13]），它的北墙 z=-1 横插进西翼内部成了一道室内隔墙，
  // 挂在墙上的那幅画（最宽的一幅 4.6）看着像悬在房间当中。
  addRectRoom(group, { cx: -6, cz: 0, width: 24, depth: 10, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling, openSides: ['east'] });
  addRectRoom(group, { cx: 12, cz: 0, width: 12, depth: 10, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling, openSides: ['west'] });
  addSkyDome(group, '#4c7891', '#8daab5', '#d7d0be');
  const pilaster = surface('#e4ddcc', { roughness: 0.58, clearcoat: 0.1 });
  addPilasters(group, 22, height, new THREE.Vector3(-6, 0, -5), new THREE.Vector3(0, 0, 1), pilaster, 4);
  addPilasters(group, 22, height, new THREE.Vector3(-6, 0, 5), new THREE.Vector3(0, 0, -1), pilaster, 4);
  return baseRoom(group, {
    bounds: bounds(-16.6, 16.6, -3.6, 3.6),
    background: '#a6bfc5',
    fogColor: '#c8cdbf',
    fogDensity: 0.0038,
    height,
    getArtworkTransform: (index) => {
      const items = [
        { position: new THREE.Vector3(-12, 2.7, -4.72), normal: new THREE.Vector3(0, 0, 1), lookAt: new THREE.Vector3(-12, 2.7, 0) },
        { position: new THREE.Vector3(-4, 2.7, -4.72), normal: new THREE.Vector3(0, 0, 1), lookAt: new THREE.Vector3(-4, 2.7, 0) },
        { position: new THREE.Vector3(-12, 2.7, 4.72), normal: new THREE.Vector3(0, 0, -1), lookAt: new THREE.Vector3(-12, 2.7, 0) },
        { position: new THREE.Vector3(-4, 2.7, 4.72), normal: new THREE.Vector3(0, 0, -1), lookAt: new THREE.Vector3(-4, 2.7, 0) },
        { position: new THREE.Vector3(-17.72, 2.7, -2), normal: new THREE.Vector3(1, 0, 0), lookAt: new THREE.Vector3(-13, 2.7, -2) },
        { position: new THREE.Vector3(12, 2.7, -4.72), normal: new THREE.Vector3(0, 0, 1), lookAt: new THREE.Vector3(12, 2.7, 0) },
        { position: new THREE.Vector3(17.72, 2.7, 0), normal: new THREE.Vector3(-1, 0, 0), lookAt: new THREE.Vector3(13, 2.7, 0) },
        { position: new THREE.Vector3(12, 2.7, 4.72), normal: new THREE.Vector3(0, 0, -1), lookAt: new THREE.Vector3(12, 2.7, 0) },
      ];
      return items[index] || items[0];
    },
    cameraStart: new THREE.Vector3(-14, 2.7, 0),
    cameraLookAt: new THREE.Vector3(-1, 2.7, 0),
    spotlight: { topColor: '#f0d8b1', sideColor: '#dce5dd', intensity: 28, sideIntensity: 11, angle: 0.4, sideAngle: 0.24, penumbra: 0.7, distance: 10, decay: 1.7 },
  });
}

function buildHighRenaissance() {
  const group = new THREE.Group();
  const radius = 15;
  const height = 9.5;
  const wall = surface('#c5beae', { roughness: 0.66, clearcoat: 0.08 });
  const floor = surface('#c3b8a5', { roughness: 0.28, clearcoat: 0.18, metalness: 0.03 });
  const ceiling = surface('#bbb3a2', { map: makeCofferTexture('#bbb3a2', '#8d887d', 512), roughness: 0.52, clearcoat: 0.08 });
  addReflectiveFloor(group, radius * 2, radius * 2, 0xd2c8b6);
  addPolygonalShell(group, radius, height, 8, wall, floor, ceiling);
  // 原值 (radius, height)：穹顶在视平线 y=2.8 处半径只有 14.33，挡在墙面 14.78 之前，
  // 墙上部、壁柱与高画幅顶部全被穹壳遮蔽。放大成 (radius+12, height) 后穹顶在墙面高度附近
  // 才收进房内，起拱点约 y=7.97，高于最高画幅顶部。
  addDomeShell(group, radius + 12, height, surface('#c8c0ae', { map: makeCofferTexture('#c8c0ae', '#8f887b', 512), roughness: 0.55, clearcoat: 0.08 }));
  addLightPanel(group, 3.1, 3.1, height + 0.22, '#dbe8e9', 1.0);
  const pilaster = surface('#e0d8c6', { roughness: 0.5, clearcoat: 0.12 });
  for (let i = 0; i < 8; i += 1) {
    // 壁柱改立在墙角：布点回到墙面中心后，原来"墙面中心"的柱子会与画幅抢位置。
    // 墙角线是两墙面的交线，半径 (radius - 0.22)/cos(π/8)（0.22 是 addWall 把墙面从切平面内移的量）；
    // 柱体深 0.28，柱心再退 0.14 使柱面正好落在墙角线上。
    // 朝向用 +angle（原为 -angle）：柱体局部 Z 是进深方向，只有 +angle 才沿半径指向墙外，
    // 原负号仅在 angle=0/180° 时朝向正确，其余壁柱长短边朝向相反。
    const cornerRadius = (radius - 0.22) / Math.cos(Math.PI / 8);
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.sin(angle) * (cornerRadius - 0.14);
    const z = Math.cos(angle) * (cornerRadius - 0.14);
    addMesh(group, new THREE.BoxGeometry(0.16, height * 0.92, 0.28), pilaster, [x, height / 2, z], [0, angle, 0]);
  }
  return baseRoom(group, {
    bounds: bounds(-radius + 1.4, radius - 1.4, -radius + 1.4, radius - 1.4),
    background: '#b8c1c2',
    fogColor: '#c2beb2',
    fogDensity: 0.0032,
    height,
    // 布点半径用 radius（画幅中心因此落在 15-0.38=14.62），距墙面 14.78 为 0.16，
    // 与其它矩形展厅的手感一致；原来 -1.65 又把画幅推到角部。
    getArtworkTransform: segmentPlacements(polySegments(radius, 8, 2.8), 2.8, 8),
    cameraStart: new THREE.Vector3(0, 2.8, 10.5),
    cameraLookAt: new THREE.Vector3(0, 2.8, 0),
    spotlight: { topColor: '#efe0bb', sideColor: '#dfe3da', intensity: 29, sideIntensity: 12, angle: 0.4, sideAngle: 0.24, penumbra: 0.72, distance: 11, decay: 1.7 },
  });
}

function buildBaroque() {
  const group = new THREE.Group();
  const width = 36;
  const depth = 14;
  const height = 10;
  const wall = surface('#a18b76', { roughness: 0.7, clearcoat: 0.05 });
  const floor = surface('#8f7862', { map: makeWoodFloorTexture('#8f7862', '#735e4e', 512), roughness: 0.31, clearcoat: 0.16 });
  const ceiling = surface('#9a8c7d', { map: makeCofferTexture('#9a8c7d', '#76695d', 512), roughness: 0.48, clearcoat: 0.08 });
  addRectRoom(group, { width, depth, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling });
  addVaultedCeiling(group, width, depth, height, ceiling, surface('#594b40', { roughness: 0.52 }), 11);
  const gold = surface('#a98755', { roughness: 0.35, metalness: 0.14, clearcoat: 0.2 });
  addBand(group, width, 8.35, new THREE.Vector3(0, 0, -depth / 2), new THREE.Vector3(0, 0, 1), gold, 0.2, 0.25);
  addBand(group, width, 8.35, new THREE.Vector3(0, 0, depth / 2), new THREE.Vector3(0, 0, -1), gold, 0.2, 0.25);
  for (let x = -12; x <= 12; x += 6) {
    addPilasters(group, 1, height, new THREE.Vector3(x, 0, -depth / 2), new THREE.Vector3(0, 0, 1), wall, 1, 0.2);
    addPilasters(group, 1, height, new THREE.Vector3(x, 0, depth / 2), new THREE.Vector3(0, 0, -1), wall, 1, 0.2);
  }
  addRoseWindow(group, -10, -depth / 2, 7.2, 1.15, new THREE.Vector3(0, 0, 1));
  addRoseWindow(group, 10, depth / 2, 7.2, 1.15, new THREE.Vector3(0, 0, -1));
  return baseRoom(group, {
    bounds: bounds(-width / 2 + 1.4, width / 2 - 1.4, -depth / 2 + 1.4, depth / 2 - 1.4),
    background: '#8a7f76',
    fogColor: '#9a8f86',
    fogDensity: 0.002,
    height,
    getArtworkTransform: segmentPlacements(rectSegments(width, depth, 2.8), 2.8, 8),
    cameraStart: new THREE.Vector3(0, 2.8, 7),
    cameraLookAt: new THREE.Vector3(0, 2.8, 0),
    spotlight: { topColor: '#f1d195', sideColor: '#d6cdba', intensity: 31, sideIntensity: 13, angle: 0.4, sideAngle: 0.23, penumbra: 0.72, distance: 12, decay: 1.7 },
  });
}

function buildRococoNeoclassical() {
  const group = new THREE.Group();
  const height = 8.2;
  const wall = surface('#ded3bd', { roughness: 0.64, clearcoat: 0.08 });
  const floor = surface('#a98e6b', { map: makeWoodFloorTexture('#a98e6b', '#806a50', 512), roughness: 0.3, clearcoat: 0.16 });
  const ceiling = surface('#e3d9c4', { map: makeNoiseTexture('#e3d9c4', '#cbbda2', 512, 0.02), roughness: 0.48 });
  // 椭圆墙在东侧留缺口：缺口弧段两端正好落在 (6.06, ±5)，与矩形展厅西开口（x=6.06, z∈[-5,5]）等宽相接。
  // 旧版是整圆筒，把矩形展厅整个封在外面——展厅里的 4 幅画在正常行走范围内进不去。
  const ovalGapHalf = Math.asin(5 / 6.5); // ≈50.3°
  addOvalShell(group, 9.5, 6.5, height, wall, floor, ceiling, Math.PI / 2 + ovalGapHalf, Math.PI * 2 - ovalGapHalf * 2);
  addRectRoom(group, { cx: 13.06, cz: 0, width: 14, depth: 10, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling, openSides: ['west'] });
  const pilaster = surface('#e9dfca', { roughness: 0.52, clearcoat: 0.15 });
  addPilasters(group, 12, height, new THREE.Vector3(13.06, 0, -5), new THREE.Vector3(0, 0, 1), pilaster, 3);
  addPilasters(group, 12, height, new THREE.Vector3(13.06, 0, 5), new THREE.Vector3(0, 0, -1), pilaster, 3);
  const ovalPlacements = [
    { position: new THREE.Vector3(0, 2.75, 6.34), normal: new THREE.Vector3(0, 0, -1), lookAt: new THREE.Vector3(0, 2.75, 0) },
    { position: new THREE.Vector3(6.70, 2.75, -4.41), normal: new THREE.Vector3(-0.58, 0, 0.81), lookAt: new THREE.Vector3(0, 2.75, 0) },
    { position: new THREE.Vector3(-6.70, 2.75, -4.41), normal: new THREE.Vector3(0.58, 0, 0.81), lookAt: new THREE.Vector3(0, 2.75, 0) },
    { position: new THREE.Vector3(-6.70, 2.75, 4.41), normal: new THREE.Vector3(0.58, 0, -0.81), lookAt: new THREE.Vector3(0, 2.75, 0) },
  ];
  const galleryPlacements = [
    { position: new THREE.Vector3(11, 2.75, -4.72), normal: new THREE.Vector3(0, 0, 1), lookAt: new THREE.Vector3(11, 2.75, 0) },
    { position: new THREE.Vector3(11, 2.75, 4.72), normal: new THREE.Vector3(0, 0, -1), lookAt: new THREE.Vector3(11, 2.75, 0) },
    { position: new THREE.Vector3(19.78, 2.75, -2.2), normal: new THREE.Vector3(-1, 0, 0), lookAt: new THREE.Vector3(15, 2.75, -2.2) },
    { position: new THREE.Vector3(19.78, 2.75, 2.2), normal: new THREE.Vector3(-1, 0, 0), lookAt: new THREE.Vector3(15, 2.75, 2.2) },
  ];
  const artworkPlacements = [...ovalPlacements, ...galleryPlacements];
  return baseRoom(group, {
    bounds: bounds(-6.7, 18.6, -3.9, 3.9),
    background: '#b7aa90',
    fogColor: '#c5b79b',
    fogDensity: 0.0018,
    height,
    getArtworkTransform: (index) => artworkPlacements[index] || artworkPlacements[0],
    cameraStart: new THREE.Vector3(-6.5, 2.7, 3.5),
    cameraLookAt: new THREE.Vector3(0, 2.75, 0),
    spotlight: { topColor: '#f2dcb2', sideColor: '#e3e2d4', intensity: 27, sideIntensity: 11, angle: 0.4, sideAngle: 0.24, penumbra: 0.7, distance: 11, decay: 1.7 },
  });
}

function buildRomantic() {
  const group = new THREE.Group();
  const width = 34;
  const depth = 18;
  const height = 10;
  const wall = surface('#96a3a6', { roughness: 0.68, clearcoat: 0.06 });
  const floor = surface('#a0968a', { map: makeNoiseTexture('#a0968a', '#887e73', 512, 0.035), roughness: 0.32, clearcoat: 0.12 });
  const ceiling = surface('#aeb9ba', { map: makeNoiseTexture('#aeb9ba', '#909da0', 512, 0.025), roughness: 0.48 });
  addRectRoom(group, { width, depth, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling });
  addGlassStrip(group, width * 0.78, height - 1.35, new THREE.Vector3(0, 0, -depth / 2), new THREE.Vector3(0, 0, 1), '#b6c8c6', 0.24);
  addGlassStrip(group, width * 0.78, height - 1.35, new THREE.Vector3(0, 0, depth / 2), new THREE.Vector3(0, 0, -1), '#b6c8c6', 0.24);
  addLightPanel(group, width * 0.48, depth * 0.3, height + 0.05, '#d4e5e3', 1.0);
  const steel = surface('#a7abad', { roughness: 0.34, metalness: 0.68, clearcoat: 0.1 });
  addBeams(group, width, depth, height, steel, 9, 0.2, 0.16);
  return baseRoom(group, {
    bounds: bounds(-width / 2 + 1.4, width / 2 - 1.4, -depth / 2 + 1.4, depth / 2 - 1.4),
    background: '#b1bdc0',
    fogColor: '#bcc6c8',
    fogDensity: 0.0018,
    height,
    getArtworkTransform: segmentPlacements(rectSegments(width, depth, 2.85), 2.85, 8),
    cameraStart: new THREE.Vector3(0, 2.7, 6.7),
    cameraLookAt: new THREE.Vector3(0, 2.9, 0),
    spotlight: { topColor: '#e7e5d5', sideColor: '#c9d9dc', intensity: 26, sideIntensity: 11, angle: 0.4, sideAngle: 0.23, penumbra: 0.72, distance: 11, decay: 1.7 },
  });
}

function buildRealism() {
  const group = new THREE.Group();
  const width = 30;
  const depth = 18;
  const height = 8.6;
  const wall = surface('#a6a59e', { roughness: 0.68, clearcoat: 0.04 });
  const floor = surface('#a09f98', { map: makeNoiseTexture('#a09f98', '#85857f', 512, 0.03), roughness: 0.29, clearcoat: 0.13 });
  const ceiling = surface('#a7a9a4', { map: makeNoiseTexture('#a7a9a4', '#8f918d', 512, 0.025), roughness: 0.5 });
  addRectRoom(group, { width, depth, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling });
  const steel = surface('#a8aaaf', { roughness: 0.36, metalness: 0.68, clearcoat: 0.1 });
  addBeams(group, width, depth, height, steel, 8, 0.22, 0.16);
  addGlassStrip(group, depth * 0.72, height - 1.2, new THREE.Vector3(-width / 2, 0, 0), new THREE.Vector3(1, 0, 0), '#b7c0ba', 0.24);
  addGlassStrip(group, depth * 0.72, height - 1.2, new THREE.Vector3(width / 2, 0, 0), new THREE.Vector3(-1, 0, 0), '#b7c0ba', 0.24);
  return baseRoom(group, {
    bounds: bounds(-width / 2 + 1.4, width / 2 - 1.4, -depth / 2 + 1.4, depth / 2 - 1.4),
    background: '#b3b5ae',
    fogColor: '#c2c3bc',
    fogDensity: 0.0018,
    height,
    getArtworkTransform: segmentPlacements(rectSegments(width, depth, 2.7), 2.7, 8),
    cameraStart: new THREE.Vector3(0, 2.6, 6),
    cameraLookAt: new THREE.Vector3(0, 2.7, 0),
    spotlight: { topColor: '#f2e4c2', sideColor: '#dbe1d9', intensity: 27, sideIntensity: 12, angle: 0.4, sideAngle: 0.23, penumbra: 0.72, distance: 11, decay: 1.7 },
  });
}

function buildImpressionism() {
  const group = new THREE.Group();
  const height = 7.8;
  const wall = surface('#cdd1c7', { roughness: 0.66, clearcoat: 0.08 });
  const floor = surface('#9d9485', { map: makeWoodFloorTexture('#9d9485', '#7c7060', 512), roughness: 0.3, clearcoat: 0.15 });
  const ceiling = surface('#d8ddd5', { map: makeNoiseTexture('#d8ddd5', '#bdc9bf', 512, 0.02), roughness: 0.5 });
  addRectRoom(group, { cx: -8, cz: 0, width: 16, depth: 19, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling, openSides: ['east'] });
  addRectRoom(group, { cx: 8, cz: 0, width: 16, depth: 19, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling, openSides: ['west'] });
  addLightPanel(group, 6.5, 8.5, height + 0.06, '#f2ead0', 1.1);
  const segments = [
    { x: -8, z: -9.5, length: 16, y: 2.75, normal: new THREE.Vector3(0, 0, 1), axis: new THREE.Vector3(1, 0, 0) },
    { x: -8, z: 9.5, length: 16, y: 2.75, normal: new THREE.Vector3(0, 0, -1), axis: new THREE.Vector3(1, 0, 0) },
    { x: 8, z: -9.5, length: 16, y: 2.75, normal: new THREE.Vector3(0, 0, 1), axis: new THREE.Vector3(1, 0, 0) },
    { x: 8, z: 9.5, length: 16, y: 2.75, normal: new THREE.Vector3(0, 0, -1), axis: new THREE.Vector3(1, 0, 0) },
    { x: -16, z: 0, length: 19, y: 2.75, normal: new THREE.Vector3(1, 0, 0), axis: new THREE.Vector3(0, 0, 1) },
    { x: 16, z: 0, length: 19, y: 2.75, normal: new THREE.Vector3(-1, 0, 0), axis: new THREE.Vector3(0, 0, 1) },
  ];
  return baseRoom(group, {
    bounds: bounds(-17, 17, -10, 10),
    background: '#8e9a94',
    fogColor: '#a7b1a9',
    fogDensity: 0.0033,
    height,
    getArtworkTransform: segmentPlacements(segments, 2.75, 8),
    cameraStart: new THREE.Vector3(0, 2.7, 7.2),
    cameraLookAt: new THREE.Vector3(0, 2.75, 0),
    spotlight: { topColor: '#f3e7c7', sideColor: '#dbe6df', intensity: 27, sideIntensity: 11, angle: 0.4, sideAngle: 0.24, penumbra: 0.72, distance: 11, decay: 1.7 },
  });
}

function buildPostImpressionism() {
  const group = new THREE.Group();
  const radius = 13;
  const height = 8.4;
  const wall = surface('#a2a38d', { roughness: 0.7, clearcoat: 0.06 });
  const floor = surface('#ad9b7e', { map: makeWoodFloorTexture('#ad9b7e', '#8e7b5e', 512), roughness: 0.31, clearcoat: 0.15 });
  const ceiling = surface('#a5ac94', { map: makeNoiseTexture('#a5ac94', '#8b927c', 512, 0.025), roughness: 0.52 });
  addPolygonalShell(group, radius, height, 8, wall, floor, ceiling);
  // 同 buildHighRenaissance：原值 (radius, height) 的穹顶在视平线处半径 12.94~14.33，
  // 挡在墙面 12.78 之前并盖住画幅上缘；放大成 (radius+12, height) 后起拱点升到墙面顶部附近。
  addDomeShell(group, radius + 12, height, surface('#b5b79f', { map: makeNoiseTexture('#b5b79f', '#96977e', 512, 0.025), roughness: 0.55, emissive: '#777c64', emissiveIntensity: 0.55 }));
  addLightPanel(group, 2.2, 2.2, height + 0.22, '#f0e3bd', 1.45);
  return baseRoom(group, {
    bounds: bounds(-radius + 1.4, radius - 1.4, -radius + 1.4, radius - 1.4),
    background: '#99a286',
    fogColor: '#aab39b',
    fogDensity: 0.0018,
    height,
    // 同 buildHighRenaissance：布点半径用 radius，画幅中心落在 13-0.38=12.62，距墙面 12.78 为 0.16。
    getArtworkTransform: segmentPlacements(polySegments(radius, 8, 2.8), 2.8, 8),
    cameraStart: new THREE.Vector3(0, 2.7, 8.2),
    cameraLookAt: new THREE.Vector3(0, 2.8, 0),
    spotlight: { topColor: '#f0d19a', sideColor: '#d8ddc4', intensity: 29, sideIntensity: 12, angle: 0.4, sideAngle: 0.24, penumbra: 0.72, distance: 11, decay: 1.7 },
  });
}

function buildModernAvantGarde() {
  const group = new THREE.Group();
  const width = 17;
  const depth = 18;
  const height = 8;
  const wall = surface('#d8d6cf', { roughness: 0.62, clearcoat: 0.12 });
  const floor = surface('#b9b5ac', { roughness: 0.28, clearcoat: 0.22, metalness: 0.02 });
  const ceiling = surface('#e1dfda', { roughness: 0.5, clearcoat: 0.05 });
  addRectRoom(group, { cx: -9, cz: 0, width, depth, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling, openSides: ['east'] });
  addRectRoom(group, { cx: 9, cz: 0, width, depth, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling, openSides: ['west'] });
  // 两翼在 x∈[-0.5, 0.5] 相接（cx=±9、width=17），地板与天花各自只铺到 0.5，中间留了一条 1 宽的缝：
  // 实测沿 x=0 竖向取 5 个点向下打射线全部打空（玩家往下看直接是背景，x=±0.5 的隔断墙也像悬空的）。
  // 用同一材质补两条 1.2 宽的窄条盖住，与两侧地板/天花同面同材质，重叠部分不可见。
  addFloor(group, 1.2, depth, floor, 0, 0, 0.01);
  addCeiling(group, 1.2, depth, ceiling, 0, 0, height);
  // 这条 1 宽的走廊在南/北两端也没有端墙（两翼的南北墙各自只到 x=±0.5），
  // 站在走廊里朝 ±z 看是一条 1 宽的通天缝。补两块端墙封口，与相邻墙端重叠 0.1，同材质不可见。
  addWall(group, 1.2, height, 0, -9, new THREE.Vector3(0, 0, 1), wall);
  addWall(group, 1.2, height, 0, 9, new THREE.Vector3(0, 0, -1), wall);
  addLightPanel(group, 4.8, 4.8, height + 0.05, '#e5e6df', 0.45);
  const partition = surface('#cfcec8', { roughness: 0.58, clearcoat: 0.1 });
  addMesh(group, new THREE.BoxGeometry(0.22, 7.4, 4.4), partition, [-0.5, height / 2, 0]);
  addMesh(group, new THREE.BoxGeometry(0.22, 7.4, 4.4), partition, [0.5, height / 2, 0]);
  const segments = [
    { x: -9, z: -9, length: 17, y: 2.7, normal: new THREE.Vector3(0, 0, 1), axis: new THREE.Vector3(1, 0, 0) },
    { x: -9, z: 9, length: 17, y: 2.7, normal: new THREE.Vector3(0, 0, -1), axis: new THREE.Vector3(1, 0, 0) },
    { x: 9, z: -9, length: 17, y: 2.7, normal: new THREE.Vector3(0, 0, 1), axis: new THREE.Vector3(1, 0, 0) },
    { x: 9, z: 9, length: 17, y: 2.7, normal: new THREE.Vector3(0, 0, -1), axis: new THREE.Vector3(1, 0, 0) },
    { x: -17.5, z: 0, length: 18, y: 2.7, normal: new THREE.Vector3(1, 0, 0), axis: new THREE.Vector3(0, 0, 1) },
    { x: 17.5, z: 0, length: 18, y: 2.7, normal: new THREE.Vector3(-1, 0, 0), axis: new THREE.Vector3(0, 0, 1) },
  ];
  return baseRoom(group, {
    // 原来 (-18, 18, -10, 10) 比真实墙体（x=±17.5、z=±9）还大，
    // 玩家能沿 x 走出 0.5、沿 z 走出 1.0 到墙外（墙是 FrontSide，走到外面会直接看穿房间）。
    // 按其它房间的统一口径改为墙体内缩 1.4。
    bounds: bounds(-16.1, 16.1, -7.6, 7.6),
    background: '#a9aaa3',
    fogColor: '#bfc0ba',
    fogDensity: 0.0016,
    height,
    getArtworkTransform: segmentPlacements(segments, 2.7, 8),
    cameraStart: new THREE.Vector3(0, 2.6, 6.5),
    cameraLookAt: new THREE.Vector3(0, 2.7, 0),
    spotlight: { topColor: '#e7e9e5', sideColor: '#d8e0e1', intensity: 23, sideIntensity: 10, angle: 0.36, sideAngle: 0.22, penumbra: 0.72, distance: 10, decay: 1.7 },
  });
}

function buildExpressionism() {
  const group = new THREE.Group();
  const width = 30;
  const depth = 22;
  const height = 8.6;
  const wall = surface('#96959b', { roughness: 0.68, clearcoat: 0.08 });
  const floor = surface('#b3afa8', { map: makeNoiseTexture('#b3afa8', '#97938d', 512, 0.03), roughness: 0.28, clearcoat: 0.2 });
  const ceiling = surface('#9898a1', { map: makeNoiseTexture('#9898a1', '#7d7d88', 512, 0.03), roughness: 0.5 });
  addRectRoom(group, { width, depth, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling });
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.3, 1.3), ceiling);
  ridge.position.set(0, height + 0.42, 0);
  group.add(ridge);
  const roof = surface('#a3a3ab', { roughness: 0.5 });
  for (const side of [-1, 1]) {
    const roofMesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.94, 11.5), roof);
    roofMesh.position.set(0, height + 0.42, side * depth * 0.25);
    roofMesh.rotation.x = side * 0.36;
    roofMesh.receiveShadow = true;
    group.add(roofMesh);
  }
  addBeams(group, width, depth, height, surface('#8e8f98', { roughness: 0.38, metalness: 0.72 }), 8, 0.2, 0.15);
  const steel = surface('#8c8c96', { roughness: 0.36, metalness: 0.7, clearcoat: 0.08 });
  for (let i = 0; i < 8; i += 1) {
    const z = (i / 7 - 0.5) * depth * 0.8;
    addMesh(group, new THREE.BoxGeometry(0.12, 1.1, 0.12), steel, [-width / 2 + 0.35, 1.2, z]);
    addMesh(group, new THREE.BoxGeometry(0.12, 1.1, 0.12), steel, [width / 2 - 0.35, 1.2, z]);
  }
  return baseRoom(group, {
    bounds: bounds(-width / 2 + 1.4, width / 2 - 1.4, -depth / 2 + 1.4, depth / 2 - 1.4),
    background: '#9698a0',
    fogColor: '#adafb6',
    fogDensity: 0.0018,
    height,
    getArtworkTransform: segmentPlacements(rectSegments(width, depth, 2.75), 2.75, 8),
    cameraStart: new THREE.Vector3(0, 2.7, 6.8),
    cameraLookAt: new THREE.Vector3(0, 2.8, 0),
    spotlight: { topColor: '#e8e0d0', sideColor: '#d7d4df', intensity: 27, sideIntensity: 11, angle: 0.38, sideAngle: 0.23, penumbra: 0.72, distance: 11, decay: 1.7 },
  });
}

function buildAmericanModern() {
  const group = new THREE.Group();
  const width = 34;
  const depth = 20;
  const height = 10.5;
  const wall = surface('#b5b1aa', { roughness: 0.68, clearcoat: 0.1 });
  const floor = surface('#a49f97', { map: makeNoiseTexture('#a49f97', '#88847e', 512, 0.025), roughness: 0.27, clearcoat: 0.24 });
  const ceiling = surface('#c4c1bb', { map: makeNoiseTexture('#c4c1bb', '#aaa7a1', 512, 0.02), roughness: 0.52 });
  addRectRoom(group, { width, depth, height, wallMat: wall, floorMat: floor, ceilingMat: ceiling });
  addLightPanel(group, width * 0.5, depth * 0.28, height + 0.04, '#d8e3e1', 0.75);
  const steel = surface('#70777a', { roughness: 0.32, metalness: 0.72, clearcoat: 0.12 });
  addBeams(group, width, depth, height, steel, 10, 0.22, 0.16);
  addBalustrade(group, width * 0.46, new THREE.Vector3(0, 0, -depth / 2 + 0.5), new THREE.Vector3(0, 0, 1), steel);
  addGlassStrip(group, width * 0.62, height - 1.25, new THREE.Vector3(0, 0, -depth / 2), new THREE.Vector3(0, 0, 1), '#aebbc0', 0.22);
  addGlassStrip(group, width * 0.62, height - 1.25, new THREE.Vector3(0, 0, depth / 2), new THREE.Vector3(0, 0, -1), '#aebbc0', 0.22);
  return baseRoom(group, {
    bounds: bounds(-width / 2 + 1.4, width / 2 - 1.4, -depth / 2 + 1.4, depth / 2 - 1.4),
    background: '#8f908d',
    fogColor: '#a5a6a2',
    fogDensity: 0.0016,
    height,
    getArtworkTransform: segmentPlacements(rectSegments(width, depth, 2.85), 2.85, 8),
    cameraStart: new THREE.Vector3(0, 2.8, 8.2),
    cameraLookAt: new THREE.Vector3(0, 2.9, 0),
    spotlight: { topColor: '#e2e9e7', sideColor: '#d8dfe0', intensity: 24, sideIntensity: 10, angle: 0.36, sideAngle: 0.22, penumbra: 0.72, distance: 11, decay: 1.7 },
  });
}

export function buildPeriodRoom(periodId) {
  switch (periodId) {
    case 'ancient-medieval':
      return buildAncientMedieval();
    case 'early-renaissance':
      return buildEarlyRenaissance();
    case 'high-renaissance':
      return buildHighRenaissance();
    case 'baroque':
      return buildBaroque();
    case 'rococo-neoclassicism':
      return buildRococoNeoclassical();
    case 'romanticism':
      return buildRomantic();
    case 'realism':
      return buildRealism();
    case 'impressionism':
      return buildImpressionism();
    case 'post-impressionism':
      return buildPostImpressionism();
    case 'modern-avant-garde':
      return buildModernAvantGarde();
    case 'expressionism-beyond':
      return buildExpressionism();
    case 'american-modern':
      return buildAmericanModern();
    default:
      return buildHighRenaissance();
  }
}
