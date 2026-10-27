// Static world: renderer, lights, sky, dirt terrain mesh, brick walls, lawn,
// chalk start line and the overhead mini-map.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAVE, FIELD, START_LINE } from '../config.js';
import { fbm2 } from '../noise.js';
import { makeBrickTexture, makeDirtNormalMap, makeDirtTexture, makeGrassTexture } from './textures.js';

export const LAYER_MAIN = 0;
export const LAYER_MINIMAP = 1;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function buildScene(renderer, terrain) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9d4f2);
  scene.fog = new THREE.Fog(0xc9e3f4, 8, 40);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  // --- lights -------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xd6e9ff, 0x7a5a3a, 0.7);
  scene.add(hemi);

  // A lowish afternoon sun: raking light shows the humps and hollows of the
  // dirt, which a high sun flattens out.
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(2.6, 2.7, 1.4);
  sun.target.position.set(0, 0, 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -2.8;
  sc.right = 2.8;
  sc.top = 2.8;
  sc.bottom = -2.8;
  sc.near = 0.5;
  sc.far = 12;
  sun.shadow.bias = -0.00004;
  sun.shadow.normalBias = 0.0025;
  sun.shadow.radius = 1.5;
  scene.add(sun);
  scene.add(sun.target);

  // --- sky dome -----------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(45, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3f85d6) },
        mid: { value: new THREE.Color(0x9fcdf0) },
        bottom: { value: new THREE.Color(0xe3eef5) },
      },
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vPos;
        void main(){ float h = normalize(vPos).y; vec3 c = h < 0.0 ? bottom : (h < 0.25 ? mix(bottom, mid, h/0.25) : mix(mid, top, (h-0.25)/0.75)); gl_FragColor = vec4(c,1.0); }`,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  // --- lawn around the yard ----------------------------------------------
  const grassTex = makeGrassTexture();
  grassTex.repeat.set(36, 36);
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 }),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(0, -0.03, 0.6);
  lawn.receiveShadow = true;
  scene.add(lawn);

  // --- dirt terrain -------------------------------------------------------
  const terrainMesh = buildTerrainMesh(terrain);
  scene.add(terrainMesh);

  // --- brick walls --------------------------------------------------------
  const walls = buildWalls();
  scene.add(walls);

  // --- chalk start line ---------------------------------------------------
  scene.add(buildStartLine(terrain));

  // --- mini-map camera & markers -----------------------------------------
  const minimap = buildMinimap();
  scene.add(minimap.markers);

  return { scene, sun, hemi, terrainMesh, walls, minimap };
}

function warp(t, a = 0.22) {
  return a * t + (1 - a) * t * t * t;
}

/** Dense near the cave, coarse at the edges: a warped grid. */
export function buildTerrainMesh(terrain) {
  const NX = 320;
  const NZ = 400;
  const positions = new Float32Array(NX * NZ * 3);
  const colors = new Float32Array(NX * NZ * 3);
  const uvs = new Float32Array(NX * NZ * 2);
  const out = { h: 0, gx: 0, gz: 0 };
  const rimLevel = terrain.caveRimHeight();
  let k = 0;
  for (let j = 0; j < NZ; j++) {
    const s = (j / (NZ - 1)) * 2 - 1;
    const z = s >= 0 ? FIELD.zMax * warp(s) : FIELD.zMin * warp(-s);
    for (let i = 0; i < NX; i++) {
      const t = (i / (NX - 1)) * 2 - 1;
      const x = t >= 0 ? FIELD.xMax * warp(t) : FIELD.xMin * warp(-t);
      terrain.heightAt(x, z, out);
      positions[k * 3] = x;
      positions[k * 3 + 1] = out.h;
      positions[k * 3 + 2] = z;
      uvs[k * 2] = x / 0.4;
      uvs[k * 2 + 1] = z / 0.4;

      // Vertex shading: dark damp bottom of the cave, worn ring around it,
      // a little mottling everywhere.
      const d = Math.hypot(x - CAVE.x, z - CAVE.z);
      // World-space mottling (never repeats like the texture tile does):
      // broad damp/dry patches plus finer variation.
      let shade = 1 + fbm2(x * 0.9 + 3, z * 0.9 + 3, 77, 3) * 0.11 + fbm2(x * 4.5, z * 4.5, 78, 2) * 0.05;
      const depthFrac = Math.max(0, (rimLevel - out.h) / CAVE.depth);
      shade *= 1 - 0.5 * Math.pow(Math.min(1, depthFrac), 0.7);
      if (d > CAVE.radius && d < CAVE.radius + 0.02) shade *= 0.9 + 0.1 * ((d - CAVE.radius) / 0.02);
      const dish = Math.max(0, 1 - d / CAVE.dishRadius);
      shade *= 1 - 0.07 * dish;
      colors[k * 3] = shade;
      colors[k * 3 + 1] = shade;
      colors[k * 3 + 2] = shade;
      k++;
    }
  }
  const index = new Uint32Array((NX - 1) * (NZ - 1) * 6);
  let q = 0;
  for (let j = 0; j < NZ - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i;
      const b = a + 1;
      const c = a + NX;
      const d = c + 1;
      index[q++] = a; index[q++] = c; index[q++] = b;
      index[q++] = b; index[q++] = c; index[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: makeDirtTexture(),
    normalMap: makeDirtNormalMap(),
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.96,
    metalness: 0,
    vertexColors: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  return mesh;
}

function buildWalls() {
  const group = new THREE.Group();
  const tex = makeBrickTexture();
  const h = FIELD.wallHeight + 0.04;
  const t = FIELD.wallThickness;
  const y = -0.04 + h / 2;
  const lenX = FIELD.xMax - FIELD.xMin + 2 * t;
  const lenZ = FIELD.zMax - FIELD.zMin;
  // Each wall gets its own material so the one between the camera and the
  // marble can be faded on its own.
  const make = (w, d, x, z, rotY, side) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    // scale brick UVs so bricks stay ~6 cm long on every face
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (w / 0.5), uv.getY(i) * (h / 0.25));
    }
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = `wall-${side}`;
    m.userData.side = side;
    m.userData.fade = 0;
    group.add(m);
  };
  const zc = (FIELD.zMin + FIELD.zMax) / 2;
  make(lenX, t, 0, FIELD.zMin - t / 2, 0, 'zMin');
  make(lenX, t, 0, FIELD.zMax + t / 2, 0, 'zMax');
  make(lenZ, t, FIELD.xMin - t / 2, zc, Math.PI / 2, 'xMin');
  make(lenZ, t, FIELD.xMax + t / 2, zc, Math.PI / 2, 'xMax');
  return group;
}

/**
 * Fade any wall that stands between the camera and the point it looks at
 * (a marble lying at the edge of the yard would otherwise hide behind the
 * bricks). Call once per frame; the fade eases in and out.
 */
export function fadeWalls(walls, camPos, target, dt) {
  const top = FIELD.wallHeight;
  for (const wall of walls.children) {
    const side = wall.userData.side;
    let want = 0;
    let f = 0; // fraction along target->camera where the sight line meets the wall plane
    if (side === 'xMin' && camPos.x < FIELD.xMin) f = (FIELD.xMin - target.x) / (camPos.x - target.x);
    else if (side === 'xMax' && camPos.x > FIELD.xMax) f = (FIELD.xMax - target.x) / (camPos.x - target.x);
    else if (side === 'zMin' && camPos.z < FIELD.zMin) f = (FIELD.zMin - target.z) / (camPos.z - target.z);
    else if (side === 'zMax' && camPos.z > FIELD.zMax) f = (FIELD.zMax - target.z) / (camPos.z - target.z);
    if (f > 0 && f < 1) {
      const yCross = target.y + f * (camPos.y - target.y);
      // Fully faded when the sight line passes through the brick, easing
      // back to solid as it rises a few centimetres above the top.
      want = 1 - Math.min(1, Math.max(0, (yCross - top) / 0.04));
    }
    const k = 1 - Math.exp(-8 * dt);
    wall.userData.fade += (want - wall.userData.fade) * k;
    const fade = wall.userData.fade;
    const transparent = fade > 0.01;
    if (wall.material.transparent !== transparent) {
      wall.material.transparent = transparent;
      wall.material.needsUpdate = true; // the shader program depends on it
    }
    wall.material.opacity = 1 - 0.8 * fade;
    wall.material.depthWrite = fade < 0.5;
    wall.castShadow = fade < 0.5;
  }
}

function buildStartLine(terrain) {
  const half = 0.008;
  const n = 100;
  const positions = [];
  const index = [];
  for (let i = 0; i <= n; i++) {
    const x = START_LINE.xMin + ((START_LINE.xMax - START_LINE.xMin) * i) / n;
    const y1 = terrain.height(x, START_LINE.z - half) + 0.0008;
    const y2 = terrain.height(x, START_LINE.z + half) + 0.0008;
    positions.push(x, y1, START_LINE.z - half, x, y2, START_LINE.z + half);
    if (i < n) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  mesh.receiveShadow = true;
  mesh.name = 'startLine';
  return mesh;
}

function buildMinimap() {
  const margin = 0.12;
  const w = FIELD.xMax - FIELD.xMin + margin * 2;
  const h = FIELD.zMax - FIELD.zMin + margin * 2;
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 20);
  camera.position.set(0, 8, (FIELD.zMin + FIELD.zMax) / 2);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, (FIELD.zMin + FIELD.zMax) / 2);
  camera.layers.enable(LAYER_MINIMAP);

  const markers = new THREE.Group();
  const cave = new THREE.Mesh(
    new THREE.RingGeometry(0.045, 0.07, 32),
    new THREE.MeshBasicMaterial({ color: 0x1a1008, side: THREE.DoubleSide }),
  );
  cave.rotation.x = -Math.PI / 2;
  cave.position.set(CAVE.x, 0.2, CAVE.z);
  cave.layers.set(LAYER_MINIMAP);
  markers.add(cave);

  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(START_LINE.xMax - START_LINE.xMin, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.2, START_LINE.z);
  line.layers.set(LAYER_MINIMAP);
  markers.add(line);

  return { camera, markers, width: w, height: h };
}

/** A flat coloured disc shown only on the mini-map. */
export function makeMinimapMarker(colorHex, radius = 0.05) {
  const g = new THREE.Group();
  const outline = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.3, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  const dot = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), new THREE.MeshBasicMaterial({ color: colorHex }));
  outline.rotation.x = dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.001;
  outline.layers.set(LAYER_MINIMAP);
  dot.layers.set(LAYER_MINIMAP);
  g.add(outline);
  g.add(dot);
  return g;
}
