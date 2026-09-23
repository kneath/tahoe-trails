import * as THREE from 'three';
import { Label, Terrain, Trailhead, toWorld } from './data';

// Peaks worth naming even when zoomed all the way out
const FAMOUS = new Set([
  'Mount Tallac',
  'Freel Peak',
  'Mount Rose',
  'Pyramid Peak',
  'Jobs Sister',
  'Dicks Peak',
  'Ellis Peak',
  'Twin Peaks',
  'Genoa Peak',
  'Snow Valley Peak',
  'Rubicon Peak',
  'Slide Mountain',
  'Relay Peak',
  'Monument Peak',
  'Ralston Peak',
  'Maggies Peaks',
  'Stevens Peak',
  'Round Top',
  'Mount Price',
  'Marlette Peak',
]);

interface Placed {
  label: Label;
  el: HTMLElement;
  world: THREE.Vector3;
  priority: number;
  w: number;
  h: number;
}

export class Labels {
  private items: Placed[] = [];
  private v = new THREE.Vector3();
  showTrailheads = false;

  constructor(
    private container: HTMLElement,
    terrain: Terrain,
    trailheads: Trailhead[],
  ) {
    const seen = new Set<string>();
    const planned: Label[] = trailheads.map((t) => ({ kind: 'trailhead', name: t.name, x: t.x, y: t.y }));
    for (const label of [...terrain.map.labels, ...planned]) {
      const key = `${label.kind}:${label.name}`;
      if (seen.has(key) && label.kind !== 'peak') continue;
      seen.add(key);
      const el = document.createElement('div');
      el.className = `label label-${label.kind}${label.name === 'Lake Tahoe' ? ' big' : ''}`;
      el.innerHTML =
        label.kind === 'peak'
          ? `<span class="peak-mark">▲</span><span class="peak-name">${label.name}</span><span class="peak-ele">${Math.round((label.ele ?? 0) * 3.28084).toLocaleString()}′</span>`
          : label.kind === 'trailhead'
            ? `<span class="th-mark">P</span><span class="th-name">${label.name}<small>new trailhead · planned</small></span>`
            : `<span>${label.name}</span>`;
      container.appendChild(el);
      const ele = label.kind === 'lake' ? terrain.heightAt(label.x, label.y) : terrain.heightAt(label.x, label.y) + 20;
      const [x, y, z] = toWorld(terrain.map, label.x, label.y, ele);
      let priority = 0;
      if (label.kind === 'town') priority = 90;
      if (label.kind === 'village') priority = 55;
      if (label.kind === 'lake') priority = label.name === 'Lake Tahoe' ? 200 : 20 + Math.log10(label.area ?? 1) * 8;
      if (label.kind === 'peak') priority = (FAMOUS.has(label.name) ? 70 : 0) + ((label.ele ?? 2000) - 2000) / 40;
      if (label.kind === 'trailhead') priority = 300;
      this.items.push({ label, el, world: new THREE.Vector3(x, y, z), priority, w: 0, h: 0 });
    }
    this.items.sort((a, b) => b.priority - a.priority);
    // measure once
    requestAnimationFrame(() => {
      for (const it of this.items) {
        it.w = it.el.offsetWidth;
        it.h = it.el.offsetHeight;
      }
    });
  }

  update(camera: THREE.OrthographicCamera, width: number, height: number) {
    const placed: [number, number, number, number][] = [];
    // how much detail to show depends on zoom
    const budget = Math.min(this.items.length, Math.round(6 + camera.zoom * 14));
    let shown = 0;
    for (const it of this.items) {
      this.v.copy(it.world).project(camera);
      const sx = ((this.v.x + 1) / 2) * width;
      const sy = ((1 - this.v.y) / 2) * height;
      const w = it.w || 80;
      const h = it.h || 18;
      // peaks and trailheads anchor at their marker, others are centered
      const anchored = it.label.kind === 'peak' || it.label.kind === 'trailhead';
      const x0 = anchored ? sx - (it.label.kind === 'peak' ? 7 : 10) : sx - w / 2;
      const y0 = it.label.kind === 'peak' ? sy - h + 4 : it.label.kind === 'trailhead' ? sy - 10 : sy - h / 2;
      const rect: [number, number, number, number] = [x0 - 4, y0 - 2, x0 + w + 4, y0 + h + 2];
      const onScreen = rect[2] > 0 && rect[0] < width && rect[3] > 0 && rect[1] < height;
      const minor = it.label.kind === 'peak' && it.priority < 70 && camera.zoom < 1.6;
      const hidden = it.label.kind === 'trailhead' && !this.showTrailheads;
      const fits = onScreen && !hidden && shown < budget && !minor && !placed.some((r) => r[0] < rect[2] && r[2] > rect[0] && r[1] < rect[3] && r[3] > rect[1]);
      if (fits) {
        placed.push(rect);
        shown++;
        it.el.style.transform = `translate(${Math.round(x0)}px, ${Math.round(y0)}px)`;
        it.el.classList.add('visible');
      } else {
        it.el.classList.remove('visible');
      }
    }
  }
}
