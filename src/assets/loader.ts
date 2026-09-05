/**
 * GLB loading, the per-url scene cache, and instancing.
 *
 * Every export here resolves or returns; none of them throw or reject.
 * A corrupt GLB, a 404, or a network failure is one warning and a `false`
 * / `null`, so the game keeps its grey-box primitive.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetEntry } from "./manifest";
import { describeError, warnOnce } from "./manifest";

/** url -> loaded gltf.scene. The cached scene is a template, never mutated. */
const sceneCache = new Map<string, THREE.Object3D>();

let loader: GLTFLoader | null = null;

function getLoader(): GLTFLoader | null {
  if (loader) return loader;
  try {
    loader = new GLTFLoader();
  } catch (err) {
    warnOnce("gltf-loader", `[assets] could not create GLTFLoader (${describeError(err)}); all models will be skipped`);
    loader = null;
  }
  return loader;
}

/** Loads one GLB into the cache. Resolves true on success, false on anything else. */
async function loadOne(url: string): Promise<boolean> {
  if (sceneCache.has(url)) return true;

  const gltfLoader = getLoader();
  if (!gltfLoader) return false;

  try {
    const gltf = await gltfLoader.loadAsync(url);
    const scene: THREE.Object3D | undefined = gltf.scene ?? gltf.scenes[0];
    if (!scene) {
      warnOnce(`glb-empty:${url}`, `[assets] ${url} loaded but contains no scene; skipping it`);
      return false;
    }
    sceneCache.set(url, scene);
    return true;
  } catch (err) {
    warnOnce(`glb-load:${url}`, `[assets] could not load ${url} (${describeError(err)}); using grey-box fallback`);
    return false;
  }
}

/**
 * Loads every url in parallel. Resolves even if all of them fail.
 * `loaded` + `missing` always equals the number of distinct urls given.
 */
export async function loadAll(urls: string[]): Promise<{ loaded: number; missing: number }> {
  let loaded = 0;
  let missing = 0;
  try {
    const results = await Promise.allSettled(urls.map((url) => loadOne(url)));
    for (const result of results) {
      // loadOne never rejects, but allSettled keeps that guarantee local.
      if (result.status === "fulfilled" && result.value) loaded += 1;
      else missing += 1;
    }
  } catch (err) {
    warnOnce("load-all", `[assets] model preload failed (${describeError(err)}); using grey-box fallbacks`);
    return { loaded: 0, missing: urls.length };
  }
  return { loaded, missing };
}

function applyTransforms(object: THREE.Object3D, entry: AssetEntry): void {
  if (entry.fitSize !== undefined) {
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (Number.isFinite(maxDim) && maxDim > 1e-6) {
        // multiply, so an authored root scale in the GLB is respected
        object.scale.multiplyScalar(entry.fitSize / maxDim);
      }
    }
  }

  if (entry.rotationY !== undefined) object.rotation.y = entry.rotationY;
  if (entry.offset) object.position.set(entry.offset[0], entry.offset[1], entry.offset[2]);

  object.updateMatrixWorld(true);
}

/**
 * Fresh deep clone of the cached scene with the entry's transforms applied.
 * Plain `Object3D.clone(true)` — no SkeletonUtils, no extra dependency.
 * Returns null if the url never loaded; the caller warns, since it knows the key.
 */
export function instantiate(entry: AssetEntry, name: string): THREE.Object3D | null {
  const template = sceneCache.get(entry.url);
  if (!template) return null;

  let clone: THREE.Object3D;
  try {
    clone = template.clone(true);
  } catch (err) {
    warnOnce(`clone:${entry.url}`, `[assets] could not clone ${entry.url} (${describeError(err)}); using grey-box fallback`);
    return null;
  }

  try {
    applyTransforms(clone, entry);
  } catch (err) {
    // An untransformed model beats no model at all.
    warnOnce(`transform:${entry.url}`, `[assets] could not apply transforms to ${entry.url} (${describeError(err)})`);
  }

  clone.name = name;
  return clone;
}
