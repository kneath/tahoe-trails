import { Trail } from './data';
import { Filter, PlanGroup, planGroup, trailColor } from './trails';

interface Handlers {
  onSelect: (id: number | null, opts?: { fly?: boolean }) => void;
  onHover: (id: number | null) => void;
  onFilter: (f: Filter) => void;
  onPlans: (groups: Set<PlanGroup>) => void;
  /** whether a trail is visible under the current filter + plan overlay */
  matches: (t: Trail) => boolean;
  onHome: () => void;
  onRotate: (dir: number) => void;
  onZoom: (factor: number) => void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export class UI {
  private filter: Filter = 'all';
  private plansOn = false;
  private planGroups = new Set<PlanGroup>(['new', 'decommission']);
  private query = '';
  private results: Trail[] = [];
  private active = -1;
  private selected: number | null = null;
  private list = $('#trail-list');
  private search = $<HTMLInputElement>('#search');
  private card = $('#card');

  constructor(
    private trails: Trail[],
    private h: Handlers,
  ) {
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.active = -1;
      this.render();
    });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.results.length;
        if (!n) return;
        this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.highlightActive();
        this.h.onHover(this.results[this.active].id);
      } else if (e.key === 'Enter') {
        const t = this.results[Math.max(0, this.active)];
        if (t) this.h.onSelect(t.id);
      } else if (e.key === 'Escape') {
        this.search.value = '';
        this.query = '';
        this.render();
        this.search.blur();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== this.search) {
        e.preventDefault();
        this.search.focus();
        this.search.select();
      }
    });
    $('#search-clear').addEventListener('click', () => {
      this.search.value = '';
      this.query = '';
      this.render();
      this.search.focus();
    });

    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.filter as Filter;
        document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('on', b === btn));
        this.h.onFilter(this.filter);
        this.render();
      });
    }

    const planBtn = $('#plan-btn');
    planBtn.addEventListener('click', () => this.setPlans(!this.plansOn));
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-plan]')) {
      btn.addEventListener('click', () => {
        const g = btn.dataset.plan as PlanGroup;
        if (this.planGroups.has(g)) this.planGroups.delete(g);
        else this.planGroups.add(g);
        btn.classList.toggle('on', this.planGroups.has(g));
        this.h.onPlans(new Set(this.planGroups));
        this.render();
      });
    }

    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (li) this.h.onSelect(Number(li.dataset.id));
    });
    this.list.addEventListener('mouseover', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      this.h.onHover(li ? Number(li.dataset.id) : null);
    });
    this.list.addEventListener('mouseleave', () => this.h.onHover(null));

    $('#btn-home').addEventListener('click', () => this.h.onHome());
    $('#btn-left').addEventListener('click', () => this.h.onRotate(-1));
    $('#btn-right').addEventListener('click', () => this.h.onRotate(1));
    $('#btn-in').addEventListener('click', () => this.h.onZoom(1.6));
    $('#btn-out').addEventListener('click', () => this.h.onZoom(1 / 1.6));

    const existing = trails.filter((t) => !t.plan);
    const miles = existing.reduce((a, t) => a + t.lengthMi, 0);
    $('#stats').textContent = `${existing.length} trails · ${Math.round(miles).toLocaleString()} miles`;
    this.render();
  }

  setPlans(on: boolean, include?: PlanGroup) {
    if (include) {
      this.planGroups.add(include);
      document.querySelector(`[data-plan="${include}"]`)?.classList.add('on');
    }
    this.plansOn = on;
    $('#plan-btn').setAttribute('aria-pressed', String(on));
    $('#plan-btn').closest('.plan-toggle')!.classList.toggle('on', on);
    $('#plan-groups').hidden = !on;
    $('#legend').hidden = on;
    $('#legend-plan').hidden = !on;
    this.h.onPlans(on ? new Set(this.planGroups) : new Set());
    this.render();
  }

  private render() {
    const q = norm(this.query);
    const words = q.split(' ').filter(Boolean);
    let results = this.trails.filter((t) => this.h.matches(t));
    if (words.length) {
      results = results
        .map((t) => {
          const hay = norm(`${t.name} ${t.area ?? ''}`);
          if (!words.every((w) => hay.includes(w))) return null;
          const name = norm(t.name);
          const score = (name.startsWith(q) ? 0 : name.split(' ').some((w) => w.startsWith(words[0])) ? 1 : 2) - t.lengthMi / 1000;
          return { t, score };
        })
        .filter((r): r is { t: Trail; score: number } => r !== null)
        .sort((a, b) => a.score - b.score)
        .map((r) => r.t);
    }
    this.results = results;
    $('#search-clear').hidden = !this.query;
    $('#result-count').textContent = words.length ? `${results.length} match${results.length === 1 ? '' : 'es'}` : `${results.length} trails`;
    if (!results.length) {
      this.list.innerHTML = `<li class="empty">No trails match “${escape(this.query)}”. Try a shorter word?</li>`;
      return;
    }
    const item = (t: Trail) => `<li data-id="${t.id}" class="${t.id === this.selected ? 'selected' : ''}">
          ${swatch(t)}
          <span class="li-name">${escape(t.name)}${t.plan ? `<small class="plan-tag">${planSummary(t)}</small>` : t.area ? `<small>${escape(t.area)}</small>` : ''}</span>
          <span class="li-len">${t.lengthMi}<small>mi</small></span>
        </li>`;
    if (this.plansOn && !words.length) {
      // planned changes first, then everything that exists today
      const planned = results.filter((t) => t.plan);
      const existing = results.filter((t) => !t.plan);
      this.list.innerHTML =
        (planned.length ? `<li class="section">Planned · ${planned.length}</li>${planned.map(item).join('')}` : '') +
        `<li class="section">On the ground today · ${existing.length}</li>${existing.map(item).join('')}`;
      return;
    }
    this.list.innerHTML = results.map(item).join('');
  }

  private highlightActive() {
    this.list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === this.active));
    this.list.querySelectorAll('li')[this.active]?.scrollIntoView({ block: 'nearest' });
  }

  showTrail(t: Trail | null) {
    this.selected = t ? t.id : null;
    this.list.querySelectorAll<HTMLElement>('li[data-id]').forEach((li) => {
      const on = t !== null && Number(li.dataset.id) === t.id;
      li.classList.toggle('selected', on);
      if (on) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    if (!t) {
      this.card.classList.remove('open');
      history.replaceState(null, '', location.pathname);
      return;
    }
    history.replaceState(null, '', `#${t.plan ? 'plan' : 'trail'}=${encodeURIComponent(t.name)}`);
    if (t.plan) return this.showPlan(t);

    const uses = [
      t.hike ? `<span class="chip hike">🥾 Hiking</span>` : '',
      t.bike
        ? `<span class="chip bike">🚵 Mountain bikes${t.bikeInferred ? '<em>likely allowed</em>' : ''}</span>`
        : t.bikePartial
          ? `<span class="chip bike">🚵 Bikes on part of it</span>`
          : `<span class="chip nobike">No bikes${t.wilderness ? ' · wilderness' : ''}</span>`,
    ].join('');

    const details: [string, string | null][] = [
      ['Bike difficulty', t.difficulty ? `${t.difficulty}${t.mtbScale !== null ? ` <small>(S${t.mtbScale})</small>` : ''}` : null],
      ['Hike difficulty', t.hikeDifficulty],
      ['Surface', t.surface ? escape(t.surface.replace(/_/g, ' ')) : null],
      ['Managed by', t.operator ? escape(t.operator) : null],
      ['Elevation', `${t.minFt.toLocaleString()}′ – ${t.maxFt.toLocaleString()}′`],
      [
        'Source',
        [t.official ? 'USFS trail inventory' : null, t.sources.includes('osm') ? 'OpenStreetMap' : null].filter(Boolean).join(' + '),
      ],
    ];

    this.card.innerHTML = `
      <button id="card-close" class="icon-btn" aria-label="Close">✕</button>
      <p class="eyebrow">${t.official ? '<span class="stamp">Official trail</span>' : ''}${t.area ? escape(t.area) : ''}</p>
      <h2>${escape(t.name)}</h2>
      <div class="chips">${uses}</div>
      <div class="stats">
        <div><b>${t.lengthMi}</b><span>miles</span></div>
        <div><b><i>↗</i>${t.gainFt.toLocaleString()}′</b><span>climbing</span></div>
        <div><b><i>↘</i>${t.lossFt.toLocaleString()}′</b><span>descending</span></div>
      </div>
      ${profileSvg(t)}
      <dl>${details
        .filter(([, v]) => v)
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
        .join('')}</dl>
      <button id="card-zoom" class="text-btn">↺ Zoom to trail</button>
    `;
    this.openCard(t);
  }

  private openCard(t: Trail) {
    $('#card-close').addEventListener('click', () => this.h.onSelect(null));
    $('#card-zoom').addEventListener('click', () => this.h.onSelect(t.id));
    this.card.classList.add('open');
  }

  private showPlan(t: Trail) {
    const plan = t.plan!;
    const group = planGroup(t)!;
    const chip = (cls: string, text: string) => `<span class="chip ${cls}">${text}</span>`;
    let chips = '';
    let change = '';
    let season: string | null = null;
    const EBIKE_SEASON = 'E-bikes April 1 – November 15';
    const MOTO_SEASON = 'Motorcycles May 25 – November 15';
    if (plan.kind === 'decommission') {
      chips = chip('nobike', '✕ To be decommissioned');
      change = 'Trail to be closed and restored (often replaced by a reroute nearby)';
    } else if (plan.kind === 'designate') {
      chips =
        plan.mode === 'moto'
          ? chip('moto', '🏍️ Opening to motorcycles')
          : chip('ebike', '⚡ Opening to Class 1 e-bikes') + chip('hike', '🥾 Hiking') + chip('bike', '🚵 Bikes');
      change = 'Existing trail, new designation';
      season = plan.mode === 'moto' ? MOTO_SEASON : EBIKE_SEASON;
    } else {
      if (plan.mode === 'moto') chips = chip('moto', '🏍️ Motorcycles');
      else {
        chips = chip('hike', '🥾 Hiking');
        if (plan.mode !== 'foot') chips += chip('bike', '🚵 Bikes');
        chips += plan.mode === 'ebike' ? chip('ebike', '⚡ Class 1 e-bikes') : chip('nobike', plan.mode === 'foot' ? 'No bikes' : 'No e-bikes');
      }
      change = plan.kind === 'adopt' ? 'Existing user-made trail, adopted into the official system' : 'New trail construction';
      season = plan.mode === 'moto' ? MOTO_SEASON : plan.mode === 'ebike' ? EBIKE_SEASON : null;
    }
    const details: [string, string | null][] = [
      ['Change', change],
      ['Season', season],
      ['Project note', plan.note ? escape(plan.note.charAt(0).toUpperCase() + plan.note.slice(1)) : null],
      ['Elevation', `${t.minFt.toLocaleString()}′ – ${t.maxFt.toLocaleString()}′`],
      [
        'Source',
        '<a href="https://www.fs.usda.gov/r05/laketahoebasin/projects/54566" target="_blank" rel="noopener">USFS Basin Wide Trails Analysis</a>, decision signed Jan 9, 2026',
      ],
    ];
    this.card.innerHTML = `
      <button id="card-close" class="icon-btn" aria-label="Close">✕</button>
      <p class="eyebrow"><span class="stamp plan" style="color:${'#' + trailColor(t).getHexString()}">Approved plan · 2026</span>${group === 'new' ? 'not built yet' : ''}</p>
      <h2>${escape(t.name)}</h2>
      <div class="chips">${chips}</div>
      <div class="stats">
        <div><b>${t.lengthMi}</b><span>miles</span></div>
        <div><b><i>↗</i>${t.gainFt.toLocaleString()}′</b><span>climbing</span></div>
        <div><b><i>↘</i>${t.lossFt.toLocaleString()}′</b><span>descending</span></div>
      </div>
      ${plan.kind === 'decommission' ? '' : profileSvg(t)}
      <dl>${details
        .filter(([, v]) => v)
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
        .join('')}</dl>
      <p class="fineprint">Alignment is planning-level from the project’s GIS. Built routes may shift, and construction is phased over several years.</p>
      <button id="card-zoom" class="text-btn">↺ Zoom to trail</button>
    `;
    this.openCard(t);
  }
}

function swatch(t: Trail) {
  if (!t.plan) return `<span class="swatch ${t.bike ? 'bike' : 'hike'}"></span>`;
  return `<span class="swatch plan" style="--c:#${trailColor(t).getHexString()}" data-kind="${planGroup(t)}"></span>`;
}

export function planSummary(t: Trail) {
  const p = t.plan!;
  if (p.kind === 'decommission') return 'to be removed';
  if (p.kind === 'designate') return p.mode === 'moto' ? 'opening to motorcycles' : 'opening to e-bikes';
  const what = p.kind === 'adopt' ? 'adopted trail' : 'new trail';
  const who = { ebike: 'bikes + e-bikes', nonmoto: 'no e-bikes', foot: 'hike only', moto: 'motorcycles', none: '' }[p.mode];
  return `${what} · ${who}`;
}

// Elevation profile of the longest continuous stretch, painted as a watercolor wash.
function profileSvg(t: Trail): string {
  const line = t.lines.reduce((a, b) => (b.length > a.length ? b : a));
  const pts: [number, number][] = [];
  let d = 0;
  for (let i = 0; i < line.length; i += 3) {
    if (i) d += Math.hypot(line[i] - line[i - 3], line[i + 1] - line[i - 2]);
    pts.push([d, line[i + 2]]);
  }
  if (pts.length < 2) return '';
  // orient west→east-ish consistently: start at the lower end
  if (pts[0][1] > pts[pts.length - 1][1]) {
    const total = d;
    pts.reverse();
    for (const p of pts) p[0] = total - p[0];
  }
  const W = 320;
  const H = 86;
  const minE = Math.min(...pts.map((p) => p[1]));
  const maxE = Math.max(...pts.map((p) => p[1]));
  const range = Math.max(60, maxE - minE);
  const x = (v: number) => (v / d) * W;
  const y = (v: number) => H - 8 - ((v - minE) / range) * (H - 22);
  const step = Math.max(1, Math.floor(pts.length / 160));
  const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const top = sampled.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const area = `${top}L${W},${H}L0,${H}Z`;
  const multi = t.lines.length > 1 ? `<span>longest continuous section</span>` : '';
  const ft = (m: number) => `${Math.round(m * 3.28084).toLocaleString()}′`;
  const stroke = '#' + trailColor(t).getHexString();
  return `
    <figure class="profile">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elevation profile">
        <defs>
          <filter id="wc" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="${t.id % 50}" />
            <feDisplacementMap in="SourceGraphic" scale="5" />
          </filter>
          <linearGradient id="pg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="${stroke}" stop-opacity="0.6" />
            <stop offset="1" stop-color="${stroke}" stop-opacity="0.12" />
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#pg)" filter="url(#wc)" />
        <path d="${top}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" filter="url(#wc)" vector-effect="non-scaling-stroke" />
      </svg>
      <figcaption><span>${ft(minE)} → ${ft(maxE)}</span>${multi}<span>${(d / 1609.34).toFixed(1)} mi</span></figcaption>
    </figure>`;
}
