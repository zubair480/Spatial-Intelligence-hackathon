/**
 * Acceptance test for the asset layer. Open /assets-test.html.
 *
 * Walks every objectKey x era x state in the manifest (unioned with the frozen
 * game contract, so the grid is complete even with an empty public/models/),
 * lays the results out on a labelled grid, and prints loaded / explicitly-null
 * / missing counts to the page. A miss is a red cube, so gaps are obvious.
 *
 * This page must work with no manifest and no models at all.
 */

import * as THREE from "three";
import { assetsReady, getAssetMesh, getBackdrop, preloadAssets } from "./index";
import type { Era } from "./manifest";
import { ERAS, getManifest, lookupBackdropSlot, lookupObjectSlot } from "./manifest";

/**
 * Frozen game contract. Used only so the grid still shows every expected
 * cell when the manifest is absent. Never invent, rename or add to these.
 */
const CONTRACT: Record<string, Record<Era, string[]>> = {
  brass_key: {
    past: ["on_counter", "held", "in_cavity", "pocketed"],
    present: ["absent", "corroded_in_cavity", "sealed_away", "never_existed"],
  },
  wall_panel: {
    past: ["closed", "open", "nailed_shut"],
    present: ["painted_over", "gap_visible", "sealed_painted_over"],
  },
};

type Status = "loaded" | "null" | "missing";

interface Cell {
  top: string;
  bottom: string;
  status: Status;
  object: THREE.Object3D | null;
}

const CELL_SIZE = 1.5;
const SPACING = 2.6;

const STATUS_COLOR: Record<Status, string> = {
  loaded: "#5ad67d",
  null: "#8d8d8d",
  missing: "#ff5b5b",
};

/* ------------------------------------------------------------------ */
/* enumeration                                                         */
/* ------------------------------------------------------------------ */

/** Contract states for an object/era, plus any extra states the manifest lists. */
function statesFor(objectKey: string, era: Era): string[] {
  const states: string[] = [];
  const contract = CONTRACT[objectKey];
  if (contract) states.push(...contract[era]);
  const fromManifest = getManifest()?.objects[objectKey]?.[era];
  if (fromManifest) {
    for (const state of Object.keys(fromManifest)) {
      if (!states.includes(state)) states.push(state);
    }
  }
  return states;
}

function objectKeys(): string[] {
  const keys = Object.keys(CONTRACT);
  const manifest = getManifest();
  if (manifest) {
    for (const key of Object.keys(manifest.objects)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function buildCells(): Cell[] {
  const cells: Cell[] = [];

  for (const objectKey of objectKeys()) {
    for (const era of ERAS) {
      for (const state of statesFor(objectKey, era)) {
        const slot = lookupObjectSlot(objectKey, era, state);
        const object = getAssetMesh(objectKey, era, state);
        cells.push({
          top: `${objectKey} / ${era}`,
          bottom: state,
          status: object ? "loaded" : slot === null ? "null" : "missing",
          object,
        });
      }
    }
  }

  for (const era of ERAS) {
    const slot = lookupBackdropSlot(era);
    const object = getBackdrop(era);
    cells.push({
      top: `backdrop / ${era}`,
      bottom: "—",
      status: object ? "loaded" : slot === null ? "null" : "missing",
      object,
    });
  }

  return cells;
}

/* ------------------------------------------------------------------ */
/* scene pieces                                                        */
/* ------------------------------------------------------------------ */

function makePlaceholder(status: Status): THREE.Object3D {
  if (status === "null") {
    // Explicitly "renders nothing": a faint outline so the cell reads as intentional.
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x5a5a5a, wireframe: true }),
    );
    return box;
  }
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xff3b30, roughness: 0.6, metalness: 0.05 }),
  );
}

function makeLabel(top: string, bottom: string, status: Status): THREE.Sprite | null {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";

  ctx.fillStyle = "#d7d7d7";
  ctx.font = "26px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(top, 256, 40);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(bottom, 256, 82);

  ctx.fillStyle = STATUS_COLOR[status];
  ctx.font = "24px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(status.toUpperCase(), 256, 126);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(2.4, 0.75, 1);
  return sprite;
}

/** Clamp-to-cell and re-centre, so one huge model cannot swallow the grid. */
function fitIntoCell(object: THREE.Object3D): THREE.Object3D {
  const holder = new THREE.Group();
  holder.add(object);
  try {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      object.position.sub(center);
      if (Number.isFinite(maxDim) && maxDim > CELL_SIZE) holder.scale.setScalar(CELL_SIZE / maxDim);
    }
  } catch {
    /* an unmeasurable model is still worth showing */
  }
  return holder;
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

function renderSummary(cells: Cell[], counts: { loaded: number; missing: number }, manifestUrl: string): void {
  const host = document.getElementById("summary");
  if (!host) return;

  const loaded = cells.filter((c) => c.status === "loaded").length;
  const nulls = cells.filter((c) => c.status === "null").length;
  const missing = cells.filter((c) => c.status === "missing").length;
  const manifest = getManifest();

  const missingList = cells
    .filter((c) => c.status === "missing")
    .map((c) => `<li>${c.top} / <b>${c.bottom}</b></li>`)
    .join("");

  host.innerHTML = [
    `<h1>asset self-test</h1>`,
    `<p class="row"><span>manifest</span> <code>${manifestUrl}</code> — ${manifest ? "parsed" : "<b class='bad'>not found</b> (grey-box fallbacks)"}</p>`,
    `<p class="row"><span>glb files</span> ${counts.loaded} loaded, ${counts.missing} failed</p>`,
    `<p class="row"><span>assetsReady()</span> ${String(assetsReady())}</p>`,
    `<p class="row"><span>states</span> `,
    `<b class="good">${loaded} loaded</b> · `,
    `<b class="muted">${nulls} explicitly null</b> · `,
    `<b class="bad">${missing} missing</b></p>`,
    missing > 0 ? `<details open><summary>missing states (red cubes)</summary><ul>${missingList}</ul></details>` : "",
    `<p class="note">Cells are re-centred and clamped to fit the grid; fitSize / rotationY / offset are still applied to the objects returned by getAssetMesh.</p>`,
  ].join("");
}

function fail(message: string): void {
  const host = document.getElementById("summary");
  if (host) host.innerHTML = `<h1>asset self-test</h1><p class="bad">${message}</p>`;
}

async function main(): Promise<void> {
  const manifestUrl = "/models/manifest.json";
  const counts = await preloadAssets(manifestUrl);

  const cells = buildCells();
  renderSummary(cells, counts, manifestUrl);

  const host = document.getElementById("stage");
  if (!host) return;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (err) {
    fail(`WebGL unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161a);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 5, 6);
  scene.add(sun);

  const cols = Math.max(1, Math.min(4, cells.length));
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const spinners: THREE.Object3D[] = [];

  cells.forEach((cell, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const group = new THREE.Group();
    group.position.set((col - (cols - 1) / 2) * SPACING, ((rows - 1) / 2 - row) * SPACING, 0);

    const tilt = new THREE.Group();
    tilt.rotation.x = -0.22;
    const spin = new THREE.Group();
    spin.add(fitIntoCell(cell.object ?? makePlaceholder(cell.status)));
    tilt.add(spin);
    tilt.position.y = 0.35;
    group.add(tilt);
    spinners.push(spin);

    const label = makeLabel(cell.top, cell.bottom, cell.status);
    if (label) {
      label.position.set(0, -0.95, 0);
      group.add(label);
    }

    scene.add(group);
  });

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);

  const resize = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height);
    const aspect = width / height;
    const halfH = (rows * SPACING) / 2 + 0.4;
    const halfW = (cols * SPACING) / 2 + 0.4;
    const viewHeight = Math.max(halfH, halfW / aspect);
    camera.top = viewHeight;
    camera.bottom = -viewHeight;
    camera.left = -viewHeight * aspect;
    camera.right = viewHeight * aspect;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  const tick = (): void => {
    try {
      const t = clock.getElapsedTime();
      for (const spin of spinners) spin.rotation.y = t * 0.6;
      renderer.render(scene, camera);
    } catch {
      /* keep the page alive even if a frame fails */
    }
    window.requestAnimationFrame(tick);
  };
  tick();
}

main().catch((err: unknown) => {
  fail(`self-test failed: ${err instanceof Error ? err.message : String(err)}`);
});
