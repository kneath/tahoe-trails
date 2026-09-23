// Data loading and coordinate helpers shared by the whole model.

export type XY = [number, number];

export interface Lake {
  name: string | null;
  area: number;
  level: number;
  outer: XY[];
  inner: XY[][];
}

export interface Label {
  kind: 'peak' | 'town' | 'village' | 'lake' | 'trailhead';
  name: string;
  x: number;
  y: number;
  ele?: number;
  area?: number;
}

export interface MapData {
  widthM: number;
  heightM: number;
  grid: { width: number; height: number; spacing: number; scale: number };
  elevation: { min: number; max: number };
  basin: XY[];
  lakes: Lake[];
  wilderness: { name: string; rings: XY[][] }[];
  labels: Label[];
  attribution: string[];
}

export type PlanKind = 'new' | 'designate' | 'adopt' | 'decommission';
export type PlanMode = 'ebike' | 'nonmoto' | 'foot' | 'moto' | 'none';

/** A change approved in the USFS Basin Wide Trails Analysis (Jan 2026) */
export interface Plan {
  kind: PlanKind;
  mode: PlanMode;
  note: string | null;
}

export interface Trailhead {
  name: string;
  x: number;
  y: number;
  capacity: number;
  note: string;
}

interface FutureData {
  project: string;
  decision: string;
  source: string;
  plans: (Plan & Pick<Trail, 'name' | 'lengthMi' | 'gainFt' | 'lossFt' | 'minFt' | 'maxFt' | 'lines'>)[];
  trailheads: Trailhead[];
}

export interface Trail {
  id: number;
  /** Set for planned (not yet built or re-designated) trails */
  plan?: Plan;
  name: string;
  area?: string;
  hike: boolean;
  bike: boolean;
  bikePartial: boolean;
  bikeInferred: boolean;
  difficulty: string | null;
  mtbScale: number | null;
  hikeDifficulty: string | null;
  surface: string | null;
  operator: string | null;
  official: boolean;
  sources: string[];
  wilderness: boolean;
  lengthMi: number;
  gainFt: number;
  lossFt: number;
  minFt: number;
  maxFt: number;
  /** Flat [x, y, elevation, x, y, elevation, …] in local meters */
  lines: number[][];
}

export const LAKE_LEVEL = 1898; // Lake Tahoe surface, meters
export const WORLD_SCALE = 100; // meters per world unit
export const EXAGGERATION = 2.3; // vertical exaggeration, for drama

export class Terrain {
  readonly heights: Float32Array;
  readonly w: number;
  readonly h: number;
  /** Heights with lakes flattened to their surface level */
  readonly surface: Float32Array;
  /** Water depth (m) where bathymetry exists, 0 elsewhere */
  readonly depth: Float32Array;
  /** 1 where the grid point is inside a lake */
  readonly water: Uint8Array;

  constructor(
    readonly map: MapData,
    raw: Uint16Array,
  ) {
    this.w = map.grid.width;
    this.h = map.grid.height;
    this.heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.heights[i] = raw[i] / map.grid.scale;
    this.surface = this.heights.slice();
    this.depth = new Float32Array(raw.length);
    this.water = new Uint8Array(raw.length);
    this.flattenLakes();
  }

  // Rasterize each lake on its own at grid resolution and flatten its points to its surface level.
  // (Painting all lakes into one canvas with color-coded ids doesn't work: where two water
  // polygons touch, anti-aliasing blends their id colors into an opaque pixel that decodes
  // to some unrelated lake, which shows up as a spike.)
  private flattenLakes() {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    for (const lake of this.map.lakes) {
      const toI = (x: number) => (x / this.map.widthM) * (this.w - 1);
      const toJ = (y: number) => (1 - y / this.map.heightM) * (this.h - 1);
      const xs = lake.outer.map(([x]) => toI(x));
      const ys = lake.outer.map(([, y]) => toJ(y));
      const i0 = Math.max(0, Math.floor(Math.min(...xs)) - 1);
      const j0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
      const i1 = Math.min(this.w, Math.ceil(Math.max(...xs)) + 2);
      const j1 = Math.min(this.h, Math.ceil(Math.max(...ys)) + 2);
      if (i1 <= i0 || j1 <= j0) continue;
      ctx.clearRect(i0, j0, i1 - i0, j1 - j0);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      for (const ring of [lake.outer, ...lake.inner]) this.tracePath(ctx, ring, this.w, this.h);
      ctx.fill('evenodd');
      const px = ctx.getImageData(i0, j0, i1 - i0, j1 - j0).data;
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          if (px[((j - j0) * (i1 - i0) + (i - i0)) * 4 + 3] < 250) continue; // skip anti-aliased edges
          const k = j * this.w + i;
          // where water polygons overlap, the lower surface wins
          if (this.water[k] && this.surface[k] <= lake.level) continue;
          this.water[k] = 1;
          this.depth[k] = Math.max(0, lake.level - this.heights[k]);
          this.surface[k] = lake.level;
        }
      }
    }
  }

  tracePath(ctx: CanvasRenderingContext2D, ring: XY[], cw: number, ch: number) {
    ring.forEach(([x, y], i) => {
      const px = (x / this.map.widthM) * cw;
      const py = (1 - y / this.map.heightM) * ch;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  /** Bilinear surface height (m) at local meters */
  heightAt(x: number, y: number): number {
    const gx = Math.min(this.w - 1.001, Math.max(0, (x / this.map.widthM) * (this.w - 1)));
    const gy = Math.min(this.h - 1.001, Math.max(0, (1 - y / this.map.heightM) * (this.h - 1)));
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const u = gx - i;
    const v = gy - j;
    const s = this.surface;
    const w = this.w;
    return (
      s[j * w + i] * (1 - u) * (1 - v) + s[j * w + i + 1] * u * (1 - v) + s[(j + 1) * w + i] * (1 - u) * v + s[(j + 1) * w + i + 1] * u * v
    );
  }

  isWater(x: number, y: number): boolean {
    const i = Math.round((x / this.map.widthM) * (this.w - 1));
    const j = Math.round((1 - y / this.map.heightM) * (this.h - 1));
    return this.water[j * this.w + i] === 1;
  }
}

// Local meters → world units. North is -Z, east is +X, up is +Y.
export function toWorld(map: MapData, x: number, y: number, ele: number): [number, number, number] {
  return [(x - map.widthM / 2) / WORLD_SCALE, ((ele - LAKE_LEVEL) / WORLD_SCALE) * EXAGGERATION, -(y - map.heightM / 2) / WORLD_SCALE];
}

export async function loadData() {
  const [map, trails, future, terrainBuf] = await Promise.all([
    fetch('data/map.json').then((r) => r.json() as Promise<MapData>),
    fetch('data/trails.json').then((r) => r.json() as Promise<Trail[]>),
    fetch('data/future.json').then((r) => r.json() as Promise<FutureData>),
    fetch('data/terrain.bin').then((r) => r.arrayBuffer()),
  ]);
  // Planned trails join the same list (ids continue after existing trails) so they can be
  // drawn, picked, searched, and shown in the card like any other trail.
  for (const p of future.plans) {
    trails.push({
      id: trails.length,
      name: p.name,
      plan: { kind: p.kind, mode: p.mode, note: p.note },
      hike: p.mode !== 'moto' && p.mode !== 'none',
      bike: p.mode === 'ebike' || p.mode === 'nonmoto',
      bikePartial: false,
      bikeInferred: false,
      difficulty: null,
      mtbScale: null,
      hikeDifficulty: null,
      surface: null,
      operator: 'USFS Lake Tahoe Basin Management Unit',
      official: true,
      sources: ['bwta'],
      wilderness: false,
      lengthMi: p.lengthMi,
      gainFt: p.gainFt,
      lossFt: p.lossFt,
      minFt: p.minFt,
      maxFt: p.maxFt,
      lines: p.lines,
    });
  }
  return { map, trails, trailheads: future.trailheads, terrain: new Terrain(map, new Uint16Array(terrainBuf)) };
}
