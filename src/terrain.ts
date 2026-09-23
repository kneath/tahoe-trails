import * as THREE from 'three';
import { EXAGGERATION, LAKE_LEVEL, Terrain, WORLD_SCALE, toWorld } from './data';
import { SIDE_FRAG, SIDE_VERT, TERRAIN_FRAG, TERRAIN_VERT, TREE_FRAG, TREE_VERT } from './shaders';

export const LIGHT_DIR = new THREE.Vector3(-0.55, 0.9, -0.45).normalize();
const BASE_ELEVATION = 1350; // bottom of the diorama block, meters

export interface Landscape {
  group: THREE.Group;
  focusUniform: { value: number };
}

export function buildLandscape(terrain: Terrain): Landscape {
  const group = new THREE.Group();
  const focusUniform = { value: 0 };
  const mask = buildMaskTexture(terrain);

  const terrainMat = new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    uniforms: { uMask: { value: mask }, uLightDir: { value: LIGHT_DIR }, uFocus: focusUniform },
  });
  group.add(new THREE.Mesh(buildSurface(terrain), terrainMat));

  const base = ((BASE_ELEVATION - LAKE_LEVEL) / WORLD_SCALE) * EXAGGERATION;
  const sideMat = new THREE.ShaderMaterial({
    vertexShader: SIDE_VERT,
    fragmentShader: SIDE_FRAG,
    uniforms: { uBase: { value: base }, uLightDir: { value: LIGHT_DIR }, uFocus: focusUniform },
  });
  group.add(new THREE.Mesh(buildSides(terrain, base), sideMat));

  const treeMat = new THREE.ShaderMaterial({
    vertexShader: TREE_VERT,
    fragmentShader: TREE_FRAG,
    uniforms: { uLightDir: { value: LIGHT_DIR }, uFocus: focusUniform },
  });
  const trees = new THREE.Mesh(buildTrees(terrain), treeMat);
  trees.frustumCulled = false;
  group.add(trees);

  return { group, focusUniform };
}

function buildSurface(t: Terrain): THREE.BufferGeometry {
  const { w, h, map } = t;
  const count = w * h;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const depth = new Float32Array(count);
  const ele = new Float32Array(count);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = (i / (w - 1)) * map.widthM;
      const y = (1 - j / (h - 1)) * map.heightM;
      const [wx, wy, wz] = toWorld(map, x, y, t.surface[k]);
      pos.set([wx, wy, wz], k * 3);
      uv.set([i / (w - 1), 1 - j / (h - 1)], k * 2);
      depth[k] = t.depth[k];
      ele[k] = t.surface[k];
    }
  }
  const index = new Uint32Array((w - 1) * (h - 1) * 6);
  let n = 0;
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      index.set([a, c, b, b, c, d], n);
      n += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geo.setAttribute('aEle', new THREE.BufferAttribute(ele, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// The four walls of the diorama block.
function buildSides(t: Terrain, base: number): THREE.BufferGeometry {
  const { w, h, map } = t;
  const positions: number[] = [];
  const normals: number[] = [];
  const tops: number[] = [];
  const edges: { pts: [number, number][]; normal: [number, number, number] }[] = [
    { pts: Array.from({ length: w }, (_, i) => [i, h - 1]), normal: [0, 0, 1] }, // south
    { pts: Array.from({ length: h }, (_, j) => [w - 1, h - 1 - j]), normal: [1, 0, 0] }, // east
    { pts: Array.from({ length: w }, (_, i) => [w - 1 - i, 0]), normal: [0, 0, -1] }, // north
    { pts: Array.from({ length: h }, (_, j) => [0, j]), normal: [-1, 0, 0] }, // west
  ];
  for (const edge of edges) {
    const top = edge.pts.map(([i, j]) =>
      toWorld(map, (i / (w - 1)) * map.widthM, (1 - j / (h - 1)) * map.heightM, t.surface[j * w + i]),
    );
    for (let k = 0; k < top.length - 1; k++) {
      const a = top[k];
      const b = top[k + 1];
      const quad = [
        [a[0], a[1], a[2], a[1]],
        [a[0], base, a[2], a[1]],
        [b[0], b[1], b[2], b[1]],
        [b[0], b[1], b[2], b[1]],
        [a[0], base, a[2], a[1]],
        [b[0], base, b[2], b[1]],
      ];
      for (const [x, y, z, ty] of quad) {
        positions.push(x, y, z);
        normals.push(...edge.normal);
        tops.push(ty);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aTop', new THREE.Float32BufferAttribute(tops, 1));
  return geo;
}

// Canvas-rasterized mask: r = water, g = distance from shore, b = inside basin.
function buildMaskTexture(t: Terrain): THREE.Texture {
  const cw = t.w * 2;
  const ch = t.h * 2;
  const lakes = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    for (const lake of t.map.lakes) {
      ctx.beginPath();
      for (const ring of [lake.outer, ...lake.inner]) t.tracePath(ctx, ring, w, h);
      ctx.fill('evenodd');
    }
  };
  // Soft layers are drawn small (blur is expensive) then scaled up.
  const layer = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, soft = 0) => {
    const scale = soft ? 0.5 : 1;
    const small = document.createElement('canvas');
    small.width = Math.round(t.w * scale);
    small.height = Math.round(t.h * scale);
    const sctx = small.getContext('2d')!;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    if (soft) {
      sctx.fillStyle = '#000';
      sctx.fillRect(0, 0, small.width, small.height);
      sctx.filter = `blur(${soft}px)`;
      sctx.fillStyle = '#fff';
      draw(sctx, small.width, small.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, cw, ch);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#fff';
      draw(ctx, cw, ch);
    }
    return ctx.getImageData(0, 0, cw, ch).data;
  };
  const water = layer(lakes);
  // "distance from shore": a wide blur, so it rises away from land
  const shoreNear = layer((ctx, w, h) => {
    const f = ctx.filter;
    ctx.filter = 'none';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.filter = f;
    lakes(ctx, w, h);
  }, 7);
  const basin = layer((ctx, w, h) => {
    ctx.beginPath();
    t.tracePath(ctx, t.map.basin, w, h);
    ctx.fill();
  }, 2);

  // Texture rows start at the south edge (v = 0), canvas rows at the north
  const data = new Uint8Array(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    for (let col = 0; col < cw; col++) {
      const src = ((ch - 1 - row) * cw + col) * 4;
      const dst = (row * cw + col) * 4;
      data[dst] = water[src];
      data[dst + 1] = 255 - shoreNear[src];
      data[dst + 2] = basin[src];
      data[dst + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, cw, ch, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Little lollipop-cone conifers, scattered in noisy clumps below treeline.
function buildTrees(t: Terrain): THREE.InstancedBufferGeometry {
  const cone = new THREE.ConeGeometry(0.22, 0.75, 6, 1);
  cone.translate(0, 0.52, 0);
  const trunk = new THREE.CylinderGeometry(0.04, 0.05, 0.2, 5, 1);
  trunk.translate(0, 0.1, 0);
  const merged = mergeGeometries([cone, trunk]);

  const rand = mulberry32(7);
  const offsets: number[] = [];
  const scales: number[] = [];
  const tints: number[] = [];
  const { map } = t;
  const tries = 160000;
  const inBasin = basinTester(t);
  for (let n = 0; n < tries; n++) {
    const x = rand() * map.widthM;
    const y = rand() * map.heightM;
    const e = t.heightAt(x, y);
    if (t.isWater(x, y) || e > 2800 + (rand() - 0.5) * 200) continue;
    // slope from neighbors
    const s = 60;
    const dx = t.heightAt(x + s, y) - t.heightAt(x - s, y);
    const dy = t.heightAt(x, y + s) - t.heightAt(x, y - s);
    const slope = Math.hypot(dx, dy) / (2 * s);
    if (slope > 0.75 || slope < 0.02) continue;
    const clump = valueNoise(x / 1400, y / 1400) * 0.7 + valueNoise(x / 350, y / 350) * 0.3;
    const threshold = inBasin(x, y) ? 0.5 : 0.62;
    if (clump < threshold + rand() * 0.15) continue;
    // keep trees off the lakeshore towns-ish flats near the lake
    if (e < LAKE_LEVEL + 15) continue;
    const [wx, wy, wz] = toWorld(map, x, y, e);
    offsets.push(wx, wy - 0.05, wz);
    scales.push(0.7 + rand() * 0.7);
    tints.push(rand());
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = merged.index;
  geo.setAttribute('position', merged.getAttribute('position'));
  geo.setAttribute('normal', merged.getAttribute('normal'));
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(scales), 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tints), 1));
  geo.instanceCount = scales.length;
  return geo;
}

function basinTester(t: Terrain) {
  const ring = t.map.basin;
  return (x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let offset = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const index = g.index!;
    for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + offset);
    offset += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const u = x - i;
  const v = y - j;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = hash(i, j);
  const b = hash(i + 1, j);
  const c = hash(i, j + 1);
  const d = hash(i + 1, j + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
