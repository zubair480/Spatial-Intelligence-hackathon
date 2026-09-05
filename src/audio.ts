// Audio layer. Every asset is optional: a missing or unplayable file must never
// break the demo, so every single call is wrapped. Browsers block autoplay until
// the first user gesture, so nothing is allowed to play before unlock() runs.

import type { Era } from "./scene";

const BASE = "/audio/";
const FILES = {
  ring: "phone_ring.mp3",
  static: "phone_static.mp3",
  tone1998: "room_tone_1998.mp3",
  tone2026: "room_tone_2026.mp3",
} as const;

export interface AudioHandle {
  unlock(): void;
  playRing(): void;
  playStatic(): void;
  setRoomTone(era: Era): void;
  stopAll(): void;
}

function make(file: string, loop: boolean, volume: number): HTMLAudioElement | null {
  try {
    const a = new Audio(BASE + file);
    a.loop = loop;
    a.volume = volume;
    a.preload = "auto";
    // A missing file must fail silently, not throw at some later play() call.
    a.addEventListener("error", () => {
      console.warn("[audio] missing or unplayable:", file);
    });
    return a;
  } catch {
    return null;
  }
}

export function mountAudio(role: Era): AudioHandle {
  const ring = make(FILES.ring, false, 0.55);
  const stat = make(FILES.static, false, 0.4);
  const tone = make(role === "past" ? FILES.tone1998 : FILES.tone2026, true, 0.22);

  let unlocked = false;
  let pendingTone = false;

  const safePlay = (el: HTMLAudioElement | null, restart = true) => {
    if (!el || !unlocked) return;
    try {
      if (restart) el.currentTime = 0;
      const p = el.play();
      // play() returns a promise in modern browsers; an autoplay rejection must
      // not surface as an unhandled rejection during the demo.
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* ignore */
    }
  };

  return {
    unlock() {
      if (unlocked) return;
      unlocked = true;
      if (pendingTone) {
        pendingTone = false;
        safePlay(tone, false);
      }
    },
    playRing() {
      safePlay(ring);
    },
    playStatic() {
      safePlay(stat);
    },
    setRoomTone(_era: Era) {
      // The tone is fixed per client role; this exists so the caller doesn't
      // have to know that, and so a future two-era client can switch.
      if (!unlocked) {
        pendingTone = true;
        return;
      }
      safePlay(tone, false);
    },
    stopAll() {
      for (const el of [ring, stat, tone]) {
        if (!el) continue;
        try {
          el.pause();
          el.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
    },
  };
}
