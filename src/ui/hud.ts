/**
 * hud.ts — non-interactive DOM overlay for the 1998 / 2026 scene.
 *
 * Sits above the Three.js canvas (z-index 50) and below the phone UI, which
 * owns anything higher. Styles are injected from this module; src/style.css is
 * never touched.
 *
 * POINTER EVENTS: the container and every descendant are pointer-events: none,
 * enforced both inline and in the injected stylesheet with !important. This
 * overlay must never intercept a click meant for the canvas. Nothing in the HUD
 * is interactive — if something here ever needs to be clickable, it belongs in
 * the phone UI instead.
 */

export type HUDRole = "past" | "present";

const STYLE_ID = "hud-styles-v1";

const CSS = `
.hud-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--hud-fg);
  -webkit-font-smoothing: antialiased;
  user-select: none;
  -webkit-user-select: none;
  contain: layout style;
}

/* Non-negotiable: nothing in this tree may ever receive a pointer event. */
.hud-root,
.hud-root * {
  pointer-events: none !important;
}

.hud-root--past {
  --hud-tint: #ffb454;
  --hud-fg: #f7eddd;
  --hud-dim: rgba(247, 237, 221, 0.55);
  --hud-panel: rgba(36, 23, 10, 0.58);
  --hud-edge: rgba(255, 180, 84, 0.34);
  --hud-glow: rgba(255, 168, 61, 0.22);
}

.hud-root--present {
  --hud-tint: #9fbdd4;
  --hud-fg: #e9f2f8;
  --hud-dim: rgba(233, 242, 248, 0.52);
  --hud-panel: rgba(11, 19, 27, 0.58);
  --hud-edge: rgba(159, 189, 212, 0.3);
  --hud-glow: rgba(126, 173, 212, 0.2);
}

.hud-panel {
  background: var(--hud-panel);
  border: 1px solid var(--hud-edge);
  border-radius: 4px;
  backdrop-filter: blur(7px) saturate(1.15);
  -webkit-backdrop-filter: blur(7px) saturate(1.15);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset,
    0 8px 22px rgba(0, 0, 0, 0.42);
}

.hud-code {
  position: absolute;
  top: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 11px 8px 9px;
}

.hud-code-mark {
  width: 3px;
  align-self: stretch;
  min-height: 14px;
  background: var(--hud-tint);
  box-shadow: 0 0 8px var(--hud-glow);
}

.hud-code-label {
  color: var(--hud-dim);
  font-size: 11px;
}

.hud-code-value {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2em;
  padding-right: 0.2em;
  text-shadow: 0 0 12px var(--hud-glow);
}

.hud-era {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 8px 12px;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.24em;
  padding-right: calc(12px + 0.24em);
  color: var(--hud-tint);
  text-shadow: 0 0 14px var(--hud-glow);
}

.hud-held {
  position: absolute;
  right: 14px;
  bottom: 58px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 11px;
  max-width: 40vw;
  transition: opacity 160ms ease, transform 160ms ease;
}

.hud-held-glyph {
  color: var(--hud-tint);
  font-size: 10px;
  text-shadow: 0 0 10px var(--hud-glow);
}

.hud-held-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hud-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  padding: 0 14px 14px;
}

.hud-hint-text {
  max-width: min(70ch, 100%);
  padding: 8px 14px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--hud-fg);
  transition: opacity 160ms ease, transform 160ms ease;
}

.hud-hidden {
  opacity: 0;
  visibility: hidden;
  transform: translateY(4px);
}

@media (max-width: 560px) {
  .hud-root { font-size: 12px; }
  .hud-era { font-size: 16px; }
  .hud-code-value { font-size: 13px; }
  .hud-held { bottom: 52px; max-width: 55vw; }
}

@media (prefers-reduced-motion: reduce) {
  .hud-held,
  .hud-hint-text { transition: none; }
}
`;

let styleRefCount = 0;
let styleEl: HTMLStyleElement | null = null;

function acquireStyles(): void {
  styleRefCount += 1;
  if (styleEl !== null && styleEl.isConnected) return;
  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    styleEl = existing;
    return;
  }
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
  styleEl = el;
}

function releaseStyles(): void {
  styleRefCount = Math.max(0, styleRefCount - 1);
  if (styleRefCount === 0 && styleEl !== null) {
    styleEl.remove();
    styleEl = null;
  }
}

function make(className: string, text?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  // Belt and braces: inline pointer-events in case the stylesheet is stripped
  // or overridden by a later build step.
  el.style.pointerEvents = "none";
  if (text !== undefined) el.textContent = text;
  return el;
}

export function mountHUD(
  root: HTMLElement,
  opts: { role: "past" | "present"; code: string }
): {
  setCode(code: string): void;
  setHint(text: string): void;
  setHeld(label: string | null): void;
  setEra(label: string): void;
  destroy(): void;
} {
  acquireStyles();

  const container = make(`hud-root hud-root--${opts.role}`);
  container.setAttribute("aria-hidden", "true");
  container.style.position = "fixed";
  container.style.inset = "0";
  container.style.zIndex = "50";

  // Session code, top-left. Written once at mount and only ever changed
  // through setCode — no other call path writes to this node.
  const codeChip = make("hud-code hud-panel");
  const codeMark = make("hud-code-mark");
  const codeLabel = make("hud-code-label", "session");
  const codeValue = make("hud-code-value", opts.code);
  codeChip.append(codeMark, codeLabel, codeValue);

  // Era, top-right.
  const era = make("hud-era hud-panel", opts.role === "past" ? "1998" : "2026");

  // Held item, bottom-right, empty until setHeld gets a label.
  const heldChip = make("hud-held hud-panel hud-hidden");
  const heldGlyph = make("hud-held-glyph", "\u25C6");
  const heldLabel = make("hud-held-label");
  heldChip.append(heldGlyph, heldLabel);

  // Hint strip, along the bottom.
  const hintBar = make("hud-hint");
  const hintText = make("hud-hint-text hud-panel hud-hidden");
  hintBar.appendChild(hintText);

  container.append(codeChip, era, heldChip, hintBar);
  root.appendChild(container);

  let destroyed = false;

  function toggle(el: HTMLElement, visible: boolean): void {
    el.classList.toggle("hud-hidden", !visible);
  }

  return {
    setCode(code: string): void {
      if (destroyed) return;
      codeValue.textContent = code;
    },

    setHint(text: string): void {
      if (destroyed) return;
      hintText.textContent = text;
      toggle(hintText, text.length > 0);
    },

    setHeld(label: string | null): void {
      if (destroyed) return;
      heldLabel.textContent = label ?? "";
      toggle(heldChip, label !== null && label.length > 0);
    },

    setEra(label: string): void {
      if (destroyed) return;
      era.textContent = label;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      container.remove();
      releaseStyles();
    },
  };
}
