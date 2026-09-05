/**
 * Late-binding 3D asset layer. Models can land in public/models/ minutes
 * before the deadline and take effect with zero changes to game code.
 *
 * Usage:
 *   await preloadAssets();                             // once at boot; never rejects
 *   const mesh = getAssetMesh("brass_key", "present", "corroded_in_cavity");
 *   scene.add(mesh ?? greyBoxFor("brass_key"));        // null => keep the primitive
 *
 * Nothing exported here throws or rejects. A missing file, a malformed
 * manifest, a corrupt GLB, or a dead network all become `null` plus a single
 * console.warn. With an empty public/models/ the game runs identically.
 */

import type * as THREE from "three";
import type { Era } from "./manifest";
import {
  collectUrls,
  describeError,
  fetchManifest,
  lookupBackdropSlot,
  lookupObjectSlot,
  setManifest,
  warnOnce,
} from "./manifest";
import { instantiate, loadAll } from "./loader";

export type { Era, AssetEntry } from "./manifest";

const DEFAULT_MANIFEST_URL = "/models/manifest.json";

let ready = false;
let started = false;

/**
 * Fetches the manifest, then loads every referenced GLB in parallel.
 * Always resolves, even if the manifest is absent and every load fails.
 * Counts are per distinct GLB url, not per state.
 */
export async function preloadAssets(
  manifestUrl: string = DEFAULT_MANIFEST_URL,
): Promise<{ loaded: number; missing: number }> {
  started = true;
  try {
    const manifest = await fetchManifest(manifestUrl);
    setManifest(manifest);
    if (!manifest) return { loaded: 0, missing: 0 };
    return await loadAll(collectUrls(manifest));
  } catch (err) {
    warnOnce(
      `preload:${manifestUrl}`,
      `[assets] preload failed (${describeError(err)}); running with grey-box fallbacks`,
    );
    return { loaded: 0, missing: 0 };
  } finally {
    ready = true;
  }
}

/** True once preloadAssets has settled. Models may still be absent. */
export function assetsReady(): boolean {
  return ready;
}

function warnMiss(key: string, reason: string): void {
  if (!started) {
    warnOnce(
      "preload-not-called",
      "[assets] getAssetMesh called before preloadAssets(); every lookup will miss until it runs",
    );
    return;
  }
  // Before preload settles, a miss is just "not yet" — stay quiet.
  if (!ready) return;
  warnOnce(`miss:${key}`, `[assets] no mesh for ${key} (${reason}); using grey-box fallback`);
}

/**
 * A fresh deep clone of the model for this state, or null.
 * Synchronous and safe to call before preloadAssets resolves (returns null).
 * An explicit `null` in the manifest means "renders nothing" and never warns.
 */
export function getAssetMesh(objectKey: string, era: Era, state: string): THREE.Object3D | null {
  const name = `${objectKey}:${era}:${state}`;
  try {
    const slot = lookupObjectSlot(objectKey, era, state);
    if (slot === null) return null; // explicit "renders nothing"
    if (slot === undefined) {
      warnMiss(name, "no manifest entry");
      return null;
    }
    const mesh = instantiate(slot, name);
    if (!mesh) warnMiss(name, `model not loaded: ${slot.url}`);
    return mesh;
  } catch (err) {
    warnOnce(`get-asset-mesh:${name}`, `[assets] getAssetMesh(${name}) failed (${describeError(err)})`);
    return null;
  }
}

/** Same contract as getAssetMesh, reading manifest.backdrops[era]. */
export function getBackdrop(era: Era): THREE.Object3D | null {
  const name = `backdrop:${era}`;
  try {
    const slot = lookupBackdropSlot(era);
    if (slot === null) return null; // explicit "renders nothing"
    if (slot === undefined) {
      warnMiss(name, "no manifest entry");
      return null;
    }
    const mesh = instantiate(slot, name);
    if (!mesh) warnMiss(name, `model not loaded: ${slot.url}`);
    return mesh;
  } catch (err) {
    warnOnce(`get-backdrop:${name}`, `[assets] getBackdrop(${era}) failed (${describeError(err)})`);
    return null;
  }
}
