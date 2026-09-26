import './setup';
import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadData, toWorld } from './data';
import { Labels } from './labels';
import { POST_FRAG, POST_VERT } from './shaders';
import { buildLandscape } from './terrain';
import { TrailLayer, planGroup } from './trails';
import { UI, planSummary } from './ui';

const VIEW_HEIGHT = 330; // world units visible vertically at zoom 1
const POLAR = 0.98; // camera tilt from vertical (radians) — close to true isometric
const HOME_AZIMUTH = 1.2; // looking west across the lake from the Nevada side

async function main() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;
  const { map, trails, trailheads, terrain } = await loadData();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shaders work directly in display colors

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.965, 0.937, 0.878);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.minZoom = 0.4;
  controls.maxZoom = 40;
  controls.minPolarAngle = 0.7;
  controls.maxPolarAngle = 1.2;
  controls.zoomSpeed = 1.4;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

  const landscape = buildLandscape(terrain);
  
  scene.add(landscape.group);
  const trailLayer = new TrailLayer(trails, terrain);
  scene.add(trailLayer.group);
  const labels = new Labels(document.getElementById('labels')!, terrain, trailheads);

  // --- watercolor post-processing
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const post = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader: POST_FRAG,
    uniforms: {
      tColor: { value: target.texture },
      uResolution: { value: new THREE.Vector2() },
      uPixelRatio: { value: renderer.getPixelRatio() },
    },
    depthTest: false,
    depthWrite: false,
  });
  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let width = 0;
  let height = 0;
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.setSize(width, height, false);
    const pr = renderer.getPixelRatio();
    target.setSize(width * pr, height * pr);
    post.uniforms.uResolution.value.set(width * pr, height * pr);
    const aspect = width / height;
    camera.left = (-VIEW_HEIGHT * aspect) / 2;
    camera.right = (VIEW_HEIGHT * aspect) / 2;
    camera.top = VIEW_HEIGHT / 2;
    camera.bottom = -VIEW_HEIGHT / 2;
    camera.updateProjectionMatrix();
    trailLayer.setResolution(width * pr, height * pr);
    dirty = true;
  }

  // --- camera animation
  const DIST = 2000;
  function placeCamera(azimuth: number, polar: number, tgt: THREE.Vector3) {
    camera.position.set(
      tgt.x + DIST * Math.sin(polar) * Math.sin(azimuth),
      tgt.y + DIST * Math.cos(polar),
      tgt.z + DIST * Math.sin(polar) * Math.cos(azimuth),
    );
    controls.target.copy(tgt);
    camera.lookAt(tgt);
  }
  let flight: null | {
    start: number;
    duration: number;
    from: { target: THREE.Vector3; zoom: number; azimuth: number; polar: number };
    to: { target: THREE.Vector3; zoom: number; azimuth: number; polar: number };
  } = null;

  function flyTo(to: { target?: THREE.Vector3; zoom?: number; azimuth?: number; polar?: number }, duration = 1100) {
    const from = {
      target: controls.target.clone(),
      zoom: camera.zoom,
      azimuth: controls.getAzimuthalAngle(),
      polar: controls.getPolarAngle(),
    };
    let azimuth = to.azimuth ?? from.azimuth;
    // take the short way around
    while (azimuth - from.azimuth > Math.PI) azimuth -= Math.PI * 2;
    while (azimuth - from.azimuth < -Math.PI) azimuth += Math.PI * 2;
    flight = {
      start: performance.now(),
      duration,
      from,
      to: { target: to.target ?? from.target, zoom: to.zoom ?? from.zoom, azimuth, polar: to.polar ?? from.polar },
    };
  }

  function stepFlight(now: number) {
    if (!flight) return;
    const t = Math.min(1, (now - flight.start) / flight.duration);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const { from, to } = flight;
    // zoom out a little mid-flight for a playful hop
    const hop = Math.sin(Math.PI * k) * 0.22;
    const zoom = Math.exp(THREE.MathUtils.lerp(Math.log(from.zoom), Math.log(to.zoom), k) - hop * Math.abs(Math.log(to.zoom / from.zoom) + 0.3));
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    placeCamera(
      THREE.MathUtils.lerp(from.azimuth, to.azimuth, k),
      THREE.MathUtils.lerp(from.polar, to.polar, k),
      from.target.clone().lerp(to.target, k),
    );
    if (t >= 1) flight = null;
    dirty = true;
  }

  // Fit a box into the part of the screen not covered by panels.
  function frameBox(
    box: THREE.Box3 | THREE.Vector3[],
    pad = { left: 380, right: 400, top: 80, bottom: 90 },
    az = flight ? flight.to.azimuth : controls.getAzimuthalAngle(),
    polar = flight ? flight.to.polar : controls.getPolarAngle(),
  ) {
    // camera basis for the destination orientation
    const tmp = new THREE.PerspectiveCamera();
    tmp.position.set(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az));
    tmp.lookAt(0, 0, 0);
    tmp.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(tmp.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(tmp.matrixWorld, 1);
    let minR = Infinity;
    let maxR = -Infinity;
    let minU = Infinity;
    let maxU = -Infinity;
    const points = Array.isArray(box)
      ? box
      : Array.from({ length: 8 }, (_, i) =>
          new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z),
        );
    for (const c of points) {
      const r = c.dot(right);
      const u = c.dot(up);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
    }
    const availW = Math.max(200, width - pad.left - pad.right);
    const availH = Math.max(200, height - pad.top - pad.bottom);
    const unitsPerPx0 = VIEW_HEIGHT / height; // at zoom 1
    const zoom = THREE.MathUtils.clamp(
      Math.min(availW / ((maxR - minR) / unitsPerPx0), availH / ((maxU - minU) / unitsPerPx0)) * 0.9,
      0.3,
      14,
    );
    const unitsPerPx = unitsPerPx0 / zoom;
    // center of the box, then shift so it sits in the middle of the free area
    const center = new THREE.Vector3()
      .addScaledVector(right, (minR + maxR) / 2)
      .addScaledVector(up, (minU + maxU) / 2);
    // (right/up span the view plane; the depth component doesn't matter for an ortho camera)
    const shiftPx = (pad.left - pad.right) / 2;
    const shiftPy = (pad.bottom - pad.top) / 2;
    const tgt = center.clone().addScaledVector(right, -shiftPx * unitsPerPx).addScaledVector(up, -shiftPy * unitsPerPx);
    // move the target onto the ground plane along the view direction so orbiting feels right
    const viewDir = tmp.position.clone().normalize();
    tgt.addScaledVector(viewDir, -tgt.y / viewDir.y);
    flyTo({ target: tgt, zoom, azimuth: az, polar });
  }

  // The basin outline, as a world-space box, is what "home" frames.
  const basinPoints = map.basin.map(([x, y]) => new THREE.Vector3(...toWorld(map, x, y, terrain.heightAt(x, y))));

  function home() {
    frameBox(basinPoints, { left: 370, right: 100, top: 40, bottom: 60 }, HOME_AZIMUTH, POLAR);
  }

  function rotate(dir: number) {
    const az = flight ? flight.to.azimuth : controls.getAzimuthalAngle();
    flyTo({ azimuth: Math.round((az + (dir * Math.PI) / 2 - HOME_AZIMUTH) / (Math.PI / 2)) * (Math.PI / 2) + HOME_AZIMUTH }, 900);
  }

  function zoomBy(f: number) {
    const z = flight ? flight.to.zoom : camera.zoom;
    flyTo({ zoom: THREE.MathUtils.clamp(z * f, controls.minZoom, controls.maxZoom) }, 450);
  }

  // --- selection state
  let selected: number | null = null;
  let hovered: number | null = null;
  let focus = 0;
  let focusTarget = 0;

  const ui = new UI(trails, {
    onSelect: (id, opts) => select(id, opts),
    onHover: (id) => setHover(id),
    onFilter: (f) => {
      trailLayer.filter = f;
      trailLayer.rebuildBase();
      dirty = true;
    },
    onPlans: (groups) => {
      trailLayer.plans = groups;
      trailLayer.rebuildBase();
      labels.showTrailheads = groups.size > 0;
      // a selected trail that just got hidden shouldn't stay highlighted
      if (selected !== null && !trailLayer.matches(trails[selected])) select(null);
      dirty = true;
    },
    matches: (t) => trailLayer.matches(t),
    onHome: home,
    onRotate: rotate,
    onZoom: zoomBy,
  });

  function select(id: number | null, opts: { fly?: boolean } = {}) {
    selected = id;
    trailLayer.setSelected(id);
    ui.showTrail(id === null ? null : trails[id]);
    focusTarget = id === null ? 0 : 1;
    if (id !== null && opts.fly !== false) frameBox(trailLayer.bounds(id));
    dirty = true;
  }

  function setHover(id: number | null) {
    if (id === hovered) return;
    hovered = id;
    trailLayer.setHover(id === selected ? null : id);
    canvas.style.cursor = id === null ? '' : 'pointer';
    dirty = true;
  }

  // --- pointer interaction on the map
  const tooltip = document.getElementById('tooltip')!;
  let down: { x: number; y: number; t: number } | null = null;
  let pointer: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    flight = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (e.buttons) {
      tooltip.classList.remove('visible');
      return;
    }
    pickDirty = true;
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    setHover(null);
    tooltip.classList.remove('visible');
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 5 && e.button === 0) {
      const id = trailLayer.pick(camera, e.clientX, e.clientY, width, height, 10);
      if (id !== null) select(id);
      else if (selected !== null) select(null);
    }
    down = null;
  });
  let pickDirty = false;
  function updatePick() {
    if (!pickDirty || !pointer) return;
    pickDirty = false;
    if (document.body.classList.contains('clean')) return;
    const id = trailLayer.pick(camera, pointer.x, pointer.y, width, height, 9);
    setHover(id);
    if (id !== null) {
      const t = trails[id];
      const kind = t.plan ? `planned: ${planSummary(t)}` : t.bike ? 'hike & bike' : 'hike only';
      tooltip.innerHTML = `<strong>${t.name}</strong><span>${t.lengthMi} mi · ${kind}</span>`;
      tooltip.style.transform = `translate(${pointer.x + 16}px, ${pointer.y + 14}px)`;
      tooltip.classList.add('visible');
    } else {
      tooltip.classList.remove('visible');
    }
  }

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'q' || e.key === 'Q') rotate(-1);
    if (e.key === 'e' || e.key === 'E') rotate(1);
    if (e.key === '=' || e.key === '+') zoomBy(1.5);
    if (e.key === '-' || e.key === '_') zoomBy(1 / 1.5);
    if (e.key === 'h' || e.key === 'H') home();
    if ((e.key === 'u' || e.key === 'U') && !e.metaKey && !e.ctrlKey && !e.altKey) toggleCleanView();
    if (e.key === 'Escape') select(null);
  });

  // "Clean view" hides every panel and control, leaving only the painted map and its labels,
  // for screenshots. A note flashes briefly so it's clear how to get the interface back.
  const toast = document.getElementById('toast')!;
  let toastTimer = 0;
  function toggleCleanView() {
    const clean = document.body.classList.toggle('clean');
    setHover(null);
    tooltip.classList.remove('visible');
    toast.textContent = clean ? 'Interface hidden · press U to bring it back' : 'Interface restored';
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1600);
  }

  // --- render loop (only redraws when something changed)
  let dirty = true;
  controls.addEventListener('change', () => {
    dirty = true;
    pickDirty = true;
  });
  const compass = document.getElementById('compass-needle')!;

  function frame(now: number) {
    requestAnimationFrame(frame);
    stepFlight(now);
    if (!flight) controls.update();
    // keep the target over the model
    const t = controls.target;
    const cx = THREE.MathUtils.clamp(t.x, -map.widthM / 200, map.widthM / 200);
    const cz = THREE.MathUtils.clamp(t.z, -map.heightM / 200, map.heightM / 200);
    if (cx !== t.x || cz !== t.z) {
      camera.position.x += cx - t.x;
      camera.position.z += cz - t.z;
      t.x = cx;
      t.z = cz;
    }
    const f = focus + (focusTarget - focus) * 0.12;
    if (Math.abs(f - focus) > 0.001) {
      focus = f;
      landscape.focusUniform.value = focus * 0.45;
      dirty = true;
    }
    updatePick();
    if (!dirty) return;
    dirty = false;
    trailLayer.setPixelsPerUnit((height / VIEW_HEIGHT) * camera.zoom);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
    labels.update(camera, width, height);
    compass.style.transform = `rotate(${(controls.getAzimuthalAngle() * 180) / Math.PI}deg)`;
  }

  window.addEventListener('resize', resize);
  resize();
  camera.zoom = 0.7;
  camera.updateProjectionMatrix();
  placeCamera(HOME_AZIMUTH + 0.5, POLAR - 0.1, new THREE.Vector3(0, 0, 0));
  requestAnimationFrame(frame);
  loading.classList.add('done');
  setTimeout(home, 150);

  // deep links: #trail=<name> or #plan=<name>
  const link = location.hash.match(/^#(trail|plan)=(.+)$/);
  if (link) {
    const name = decodeURIComponent(link[2]).toLowerCase();
    const isPlan = link[1] === 'plan';
    const t = trails.find((t) => !!t.plan === isPlan && t.name.toLowerCase() === name);
    if (t) {
      if (isPlan) ui.setPlans(true, planGroup(t)!);
      setTimeout(() => select(t.id), 1300);
    }
  }
}

main().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = 'Something went wrong loading the map.';
});
