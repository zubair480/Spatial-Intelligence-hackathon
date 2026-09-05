// THE CAUSALITY TABLE
// Key format: "<objectKey>:<newPastState>"
// Value: the present-era rows that must change as a consequence.
// Every past state MUST have an entry or the action is a silent no-op.

export type Consequence = { key: string; state: string };

export const CAUSALITY: Record<string, Consequence[]> = {
  // --- co-op path ---
  "wall_panel:open": [{ key: "wall_panel", state: "gap_visible" }],
  "brass_key:in_cavity": [{ key: "brass_key", state: "corroded_in_cavity" }],

  // --- sabotage path (phase === "turned") ---
  "wall_panel:nailed_shut": [
    { key: "wall_panel", state: "sealed_painted_over" },
    { key: "brass_key", state: "sealed_away" },
  ],
  "brass_key:pocketed": [{ key: "brass_key", state: "never_existed" }],
};

export const INITIAL_STATE = {
  past: { brass_key: "on_counter", wall_panel: "closed" },
  present: { brass_key: "absent", wall_panel: "painted_over" },
} as const;

export const TIMER_MS = 5 * 60 * 1000;
