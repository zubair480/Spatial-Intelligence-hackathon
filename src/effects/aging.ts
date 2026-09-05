/**
 * "28 years pass" — the beat that plays when the past player changes something
 * and the present player's world updates around them.
 *
 * Design constraints this file honours:
 *  - No postprocessing, no EffectComposer, no new dependencies. The full-frame
 *    part is a camera-facing overlay quad plus light desaturation, so it works
 *    on any renderer setup.
 *  - Nothing owned by the game is mutated. No material on a game mesh is ever
 *    touched, because clone(true) shares materials between instances and a
 *    mutation would flash every clone of that model. The localised flash is an
 *    additive shell plus a glow sprite that this module creates, adds, and
 *    disposes itself.
 *  - Every entry point is wrapped: a failure restores the scene and goes inert
 *    rather than throwing into the render loop.
 *
 * Usage:
 *   const aging = mountAging(scene, camera, renderer);
 *   aging.pulse(newMesh);            // or pulse(null) for the frame beat alone
 *   aging.update(clock.getDelta());  // once per frame
 */

import * as THREE from "three";

const DURATION = 0.9; // seconds; the whole beat

const OVERLAY_OPACITY = 0.5; // peak darkening of the frame
const LIGHT_DESATURATE = 0.85; // how far light colours travel toward grey
const LIGHT_DIM = 0.5; // fraction of light intensity removed at peak
const EXPOSURE_DIM = 0.4; // only applies when tone mapping is enabled

const SHELL_COLOR = 0xffd9a8;
const GLOW_COLOR = 0xffe9c4;
const POINT_LIGHT_PEAK = 12;

const MAX_FRAME_DT = 0.1; // clamp tab-switch spikes

interface LightState {
  light: THREE.Light;
  color: THREE.Color;
  intensity: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Full-frame envelope: quick dip, short hold, slower recovery. */
function frameEnvelope(u: number): number {
  return smoothstep(0, 0.14, u) * (1 - smoothstep(0.4, 0.96, u));
}

/** Localised flash: near-instant attack, long tail that resolves into the object. */
function flashEnvelope(u: number): number {
  const attack = smoothstep(0, 0.07, u);
  const decay = 1 - smoothstep(0.07, 0.88, u);
  return attack * decay * decay;
}

/** Soft radial gradient for the glow sprite. Null if 2D canvas is unavailable. */
function makeGlowTexture(): THREE.Texture | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,236,200,0.55)");
    gradient.addColorStop(1, "rgba(255,220,170,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  } catch {
    return null;
  }
}

export function mountAging(
  scene: THREE.Scene,
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
): {
  pulse(target: THREE.Object3D | null): void;
  update(dtSeconds: number): void;
  destroy(): void;
} {
  const inert = {
    pulse: (): void => {},
    update: (): void => {},
    destroy: (): void => {},
  };

  // Defensive: the types promise these, the 16:00 merge might not.
  if (!scene || typeof scene.add !== "function" || !camera) return inert;

  let destroyed = false;
  let active = false;
  let elapsed = 0;
  let warned = false;

  // Frame-wide state
  let overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  let overlayAttached = false;
  const lightStates: LightState[] = [];
  let exposureSaved: number | null = null;

  // Localised state
  let shell: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  let glow: THREE.Sprite | null = null;
  let flashLight: THREE.PointLight | null = null;
  let flashTarget: THREE.Object3D | null = null;
  let flashRadius = 0.35;
  const flashOffset = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  function warnOnce(message: string, err: unknown): void {
    if (warned) return;
    warned = true;
    try {
      console.warn(`[aging] ${message}`, err);
    } catch {
      /* ignore */
    }
  }

  /* ---------------- full-frame ---------------- */

  function ensureOverlay(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null {
    if (overlay) return overlay;
    const material = new THREE.MeshBasicMaterial({
      color: 0x05070c,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    overlay.name = "aging:overlay";
    overlay.frustumCulled = false;
    overlay.renderOrder = 9998;
    overlay.matrixAutoUpdate = true;
    return overlay;
  }

  /** Parks the quad just past the near plane, filling the frustum. */
  function positionOverlay(quad: THREE.Object3D): boolean {
    const perspective = camera as THREE.PerspectiveCamera;
    const orthographic = camera as THREE.OrthographicCamera;

    let width: number;
    let height: number;
    let distance: number;

    if (perspective.isPerspectiveCamera) {
      distance = Math.max(perspective.near * 1.05, perspective.near + 0.001);
      height = 2 * distance * Math.tan((perspective.fov * Math.PI) / 360);
      width = height * perspective.aspect;
    } else if (orthographic.isOrthographicCamera) {
      const zoom = orthographic.zoom || 1;
      distance = orthographic.near + 0.001;
      height = Math.abs(orthographic.top - orthographic.bottom) / zoom;
      width = Math.abs(orthographic.right - orthographic.left) / zoom;
    } else {
      return false; // unknown projection: skip the quad, keep the light beat
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;

    camera.updateMatrixWorld();
    const position = camera.getWorldPosition(new THREE.Vector3());
    const quaternion = camera.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);

    quad.quaternion.copy(quaternion);
    quad.position.copy(position).addScaledVector(forward, distance);
    quad.scale.set(width * 1.2, height * 1.2, 1);
    return true;
  }

  function captureLights(): void {
    lightStates.length = 0;
    scene.traverse((object) => {
      const light = object as THREE.Light;
      if (light.isLight === true && light.color) {
        lightStates.push({ light, color: light.color.clone(), intensity: light.intensity });
      }
    });
  }

  function applyLights(amount: number): void {
    for (const state of lightStates) {
      const base = state.color;
      const luminance = base.r * 0.2126 + base.g * 0.7152 + base.b * 0.0722;
      const k = amount * LIGHT_DESATURATE;
      state.light.color.setRGB(
        base.r + (luminance - base.r) * k,
        base.g + (luminance - base.g) * k,
        base.b + (luminance - base.b) * k,
      );
      state.light.intensity = state.intensity * (1 - LIGHT_DIM * amount);
    }
  }

  function restoreLights(): void {
    for (const state of lightStates) {
      state.light.color.copy(state.color);
      state.light.intensity = state.intensity;
    }
    lightStates.length = 0;
  }

  function captureExposure(): void {
    if (!renderer) return;
    if (renderer.toneMapping === THREE.NoToneMapping) return; // exposure is ignored anyway
    exposureSaved = renderer.toneMappingExposure;
  }

  function applyExposure(amount: number): void {
    if (exposureSaved === null || !renderer) return;
    renderer.toneMappingExposure = exposureSaved * (1 - EXPOSURE_DIM * amount);
  }

  function restoreExposure(): void {
    if (exposureSaved !== null && renderer) renderer.toneMappingExposure = exposureSaved;
    exposureSaved = null;
  }

  /* ---------------- localised ---------------- */

  function attachFlash(target: THREE.Object3D): void {
    flashTarget = target;
    flashRadius = 0.35;
    flashOffset.set(0, 0, 0);

    try {
      target.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(target);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (Number.isFinite(maxDim) && maxDim > 1e-4) {
          flashRadius = Math.min(Math.max(maxDim * 0.5, 0.05), 50);
        }
        flashOffset.copy(center).sub(target.getWorldPosition(new THREE.Vector3()));
      }
    } catch (err) {
      warnOnce("could not measure pulse target; using default radius", err);
    }

    // Additive shell: sits in the world, occluded by geometry in front of it.
    shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({
        color: SHELL_COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    shell.name = "aging:shell";
    shell.renderOrder = 9990;
    scene.add(shell);

    // Glow sprite: depthTest off on purpose. The key materialises behind a
    // radiator; if the glow is occluded the audience misses the whole beat.
    const texture = makeGlowTexture();
    if (texture) {
      glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          color: GLOW_COLOR,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      glow.name = "aging:glow";
      glow.renderOrder = 9991;
      scene.add(glow);
    }

    flashLight = new THREE.PointLight(SHELL_COLOR, 0, flashRadius * 10, 2);
    flashLight.name = "aging:light";
    scene.add(flashLight);
  }

  function applyFlash(amount: number): void {
    if (!flashTarget) return;

    scratch.copy(flashTarget.getWorldPosition(new THREE.Vector3())).add(flashOffset);

    if (shell) {
      const scale = flashRadius * (0.8 + 0.9 * (1 - amount));
      shell.position.copy(scratch);
      shell.scale.setScalar(scale);
      shell.material.opacity = 0.85 * amount;
      shell.visible = amount > 0.001;
    }
    if (glow) {
      glow.position.copy(scratch);
      glow.scale.setScalar(flashRadius * 7 * (0.7 + 0.5 * amount));
      glow.material.opacity = amount;
      glow.visible = amount > 0.001;
    }
    if (flashLight) {
      flashLight.position.copy(scratch);
      flashLight.intensity = POINT_LIGHT_PEAK * flashRadius * amount;
      flashLight.visible = amount > 0.001;
    }
  }

  function disposeFlash(): void {
    if (shell) {
      scene.remove(shell);
      shell.geometry.dispose();
      shell.material.dispose();
      shell = null;
    }
    if (glow) {
      scene.remove(glow);
      if (glow.material.map) glow.material.map.dispose();
      glow.material.dispose();
      glow = null;
    }
    if (flashLight) {
      scene.remove(flashLight);
      flashLight.dispose();
      flashLight = null;
    }
    flashTarget = null;
  }

  /* ---------------- lifecycle ---------------- */

  /** Puts everything the module borrowed back the way it was. */
  function settle(): void {
    active = false;
    elapsed = 0;
    restoreLights();
    restoreExposure();
    if (overlay) {
      overlay.material.opacity = 0;
      overlay.visible = false;
      if (overlayAttached) {
        scene.remove(overlay);
        overlayAttached = false;
      }
    }
    disposeFlash();
  }

  return {
    pulse(target: THREE.Object3D | null): void {
      if (destroyed) return;
      try {
        settle(); // a second pulse mid-beat restarts cleanly

        active = true;
        elapsed = 0;

        captureLights();
        captureExposure();

        const quad = ensureOverlay();
        if (quad && positionOverlay(quad)) {
          quad.visible = true;
          scene.add(quad);
          overlayAttached = true;
        }

        if (target) attachFlash(target);

        // Paint frame zero now, so a pulse is visible even if update() is late.
        applyLights(0);
        applyExposure(0);
        applyFlash(0);
      } catch (err) {
        warnOnce("pulse failed; scene restored", err);
        try {
          settle();
        } catch {
          /* ignore */
        }
      }
    },

    update(dtSeconds: number): void {
      if (destroyed || !active) return;
      try {
        const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? Math.min(dtSeconds, MAX_FRAME_DT) : 0;
        elapsed += dt;
        const u = clamp01(elapsed / DURATION);

        const frame = frameEnvelope(u);
        if (overlay && overlayAttached) {
          positionOverlay(overlay);
          overlay.material.opacity = OVERLAY_OPACITY * frame;
          overlay.visible = frame > 0.001;
        }
        applyLights(frame);
        applyExposure(frame);
        applyFlash(flashEnvelope(u));

        if (elapsed >= DURATION) settle();
      } catch (err) {
        warnOnce("update failed; effect disabled for this pulse", err);
        try {
          settle();
        } catch {
          /* ignore */
        }
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try {
        settle();
        if (overlay) {
          scene.remove(overlay);
          overlay.geometry.dispose();
          overlay.material.dispose();
          overlay = null;
        }
        overlayAttached = false;
      } catch (err) {
        warnOnce("destroy failed", err);
      }
    },
  };
}
