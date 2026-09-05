/**
 * Manifest types, defensive parsing, and the in-memory manifest cache.
 *
 * Nothing in this file may throw. A manifest that is absent, unreachable,
 * malformed, or half-garbage degrades to "fewer entries" or `null`, never to
 * an exception. Entries that fail validation are dropped, which turns them
 * into ordinary misses (one warning, grey-box fallback in the game).
 */

export type Era = "past" | "present";

export interface AssetEntry {
  url: string; // relative to /, e.g. "/models/brass_key_new.glb"
  fitSize?: number; // uniform-scale so max bbox dimension equals this
  rotationY?: number; // radians
  offset?: [number, number, number];
}

/**
 * A manifest slot is either an entry, or an explicit `null` meaning
 * "this state renders nothing". `undefined` (key absent) means a miss.
 * The two are deliberately different: explicit null never warns.
 */
export type AssetSlot = AssetEntry | null;

export interface AssetManifest {
  objects: Record<string, Partial<Record<Era, Record<string, AssetSlot>>>>;
  backdrops: Partial<Record<Era, AssetSlot>>;
}

export const ERAS: readonly Era[] = ["past", "present"];

/* ------------------------------------------------------------------ */
/* one-warning-per-key logging                                         */
/* ------------------------------------------------------------------ */

const warned = new Set<string>();

/** Logs `message` the first time this `key` is seen, then never again. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  try {
    console.warn(message);
  } catch {
    /* a console that throws is not our problem to solve */
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "unknown error";
  }
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEra(value: string): value is Era {
  return value === "past" || value === "present";
}

/** Returns an entry, `null` for an explicit null, or `undefined` for junk. */
function parseSlot(raw: unknown, where: string): AssetSlot | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) {
    warnOnce(`manifest-slot:${where}`, `[assets] manifest entry ${where} is not an object; ignoring it`);
    return undefined;
  }

  const url = raw.url;
  if (typeof url !== "string" || url.length === 0) {
    warnOnce(`manifest-url:${where}`, `[assets] manifest entry ${where} has no usable "url"; ignoring it`);
    return undefined;
  }

  const entry: AssetEntry = { url };

  const fitSize = raw.fitSize;
  if (typeof fitSize === "number" && Number.isFinite(fitSize) && fitSize > 0) {
    entry.fitSize = fitSize;
  }

  const rotationY = raw.rotationY;
  if (typeof rotationY === "number" && Number.isFinite(rotationY)) {
    entry.rotationY = rotationY;
  }

  const offset = raw.offset;
  if (
    Array.isArray(offset) &&
    offset.length === 3 &&
    offset.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    entry.offset = [offset[0] as number, offset[1] as number, offset[2] as number];
  }

  return entry;
}

/** Turns arbitrary parsed JSON into a manifest. Never throws. */
export function parseManifest(raw: unknown): AssetManifest {
  const manifest: AssetManifest = { objects: {}, backdrops: {} };
  if (!isRecord(raw)) {
    warnOnce("manifest-shape", "[assets] manifest is not a JSON object; running with grey-box fallbacks");
    return manifest;
  }

  const objects = raw.objects;
  if (isRecord(objects)) {
    for (const objectKey of Object.keys(objects)) {
      const eras = objects[objectKey];
      if (!isRecord(eras)) continue;
      const byEra: Partial<Record<Era, Record<string, AssetSlot>>> = {};
      for (const eraKey of Object.keys(eras)) {
        if (!isEra(eraKey)) continue;
        const states = eras[eraKey];
        if (!isRecord(states)) continue;
        const bySlot: Record<string, AssetSlot> = {};
        for (const state of Object.keys(states)) {
          const slot = parseSlot(states[state], `${objectKey}:${eraKey}:${state}`);
          if (slot !== undefined) bySlot[state] = slot;
        }
        byEra[eraKey] = bySlot;
      }
      manifest.objects[objectKey] = byEra;
    }
  }

  const backdrops = raw.backdrops;
  if (isRecord(backdrops)) {
    for (const eraKey of Object.keys(backdrops)) {
      if (!isEra(eraKey)) continue;
      const slot = parseSlot(backdrops[eraKey], `backdrop:${eraKey}`);
      if (slot !== undefined) manifest.backdrops[eraKey] = slot;
    }
  }

  return manifest;
}

/** Fetches and parses the manifest. Resolves to null on any failure. */
export async function fetchManifest(url: string): Promise<AssetManifest | null> {
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
      warnOnce(
        `manifest-http:${url}`,
        `[assets] manifest ${url} returned HTTP ${response.status}; running with grey-box fallbacks`,
      );
      return null;
    }
    const raw: unknown = await response.json();
    return parseManifest(raw);
  } catch (err) {
    warnOnce(
      `manifest-fetch:${url}`,
      `[assets] could not load manifest ${url} (${describeError(err)}); running with grey-box fallbacks`,
    );
    return null;
  }
}

/** Every distinct GLB url the manifest references. */
export function collectUrls(manifest: AssetManifest): string[] {
  const urls = new Set<string>();
  for (const eras of Object.values(manifest.objects)) {
    for (const era of ERAS) {
      const states = eras[era];
      if (!states) continue;
      for (const slot of Object.values(states)) {
        if (slot) urls.add(slot.url);
      }
    }
  }
  for (const era of ERAS) {
    const slot = manifest.backdrops[era];
    if (slot) urls.add(slot.url);
  }
  return Array.from(urls);
}

/* ------------------------------------------------------------------ */
/* cache + lookups                                                     */
/* ------------------------------------------------------------------ */

let cachedManifest: AssetManifest | null = null;

export function setManifest(manifest: AssetManifest | null): void {
  cachedManifest = manifest;
}

export function getManifest(): AssetManifest | null {
  return cachedManifest;
}

/** `undefined` = miss, `null` = explicitly renders nothing. */
export function lookupObjectSlot(objectKey: string, era: Era, state: string): AssetSlot | undefined {
  const states = cachedManifest?.objects[objectKey]?.[era];
  if (!states) return undefined;
  if (!Object.prototype.hasOwnProperty.call(states, state)) return undefined;
  return states[state];
}

/** `undefined` = miss, `null` = explicitly renders nothing. */
export function lookupBackdropSlot(era: Era): AssetSlot | undefined {
  const backdrops = cachedManifest?.backdrops;
  if (!backdrops) return undefined;
  if (!Object.prototype.hasOwnProperty.call(backdrops, era)) return undefined;
  return backdrops[era];
}
