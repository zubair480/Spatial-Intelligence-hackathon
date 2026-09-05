// Baseline UI overlay. Zaynab's version drops in here against the same
// exported signature — do not change the signature without telling her.

export type Role = "past" | "present";
export type Phase = "coop" | "turned" | "ended";
export interface Msg { from: Role; text: string; at: number }

export interface PhoneUI {
  renderMessages(msgs: Msg[]): void;
  setTimer(secondsRemaining: number): void;
  setPhase(phase: Phase): void;
  showObjectiveCard(title: string, body: string): void;
  showEnding(type: "escaped" | "trapped"): void;
  setHint(text: string): void;
  onSabotage(cb: () => void): void;
  destroy(): void;
}

const CSS = `
.pl-root{position:fixed;inset:0;pointer-events:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;z-index:10}
.pl-root *{box-sizing:border-box}
.pl-phone{position:absolute;left:20px;bottom:20px;width:340px;max-height:46vh;display:flex;flex-direction:column;
  background:rgba(12,12,14,.86);border:1px solid var(--pl-line);border-radius:10px;pointer-events:auto;overflow:hidden}
.pl-phone-hd{padding:8px 12px;font-size:12px;letter-spacing:.14em;color:var(--pl-accent);border-bottom:1px solid var(--pl-line)}
.pl-log{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-height:140px}
.pl-msg{font-size:14px;line-height:1.4;max-width:88%;padding:6px 10px;border-radius:8px;color:#e8e6e2}
.pl-me{align-self:flex-end;background:rgba(255,255,255,.10)}
.pl-them{align-self:flex-start;background:var(--pl-them)}
.pl-inrow{display:flex;border-top:1px solid var(--pl-line)}
.pl-in{flex:1;background:transparent;border:0;outline:0;color:#f2f0ec;padding:11px 12px;font:inherit;font-size:14px}
.pl-send{background:transparent;border:0;color:var(--pl-accent);padding:0 14px;cursor:pointer;font:inherit;font-size:13px}
.pl-timer{position:absolute;top:18px;left:50%;transform:translateX(-50%);font-size:30px;letter-spacing:.08em;
  color:#f2f0ec;text-shadow:0 2px 12px #000}
.pl-timer.crit{color:#ff5c4d;animation:plp 1s steps(2,end) infinite}
@keyframes plp{50%{opacity:.35}}
.pl-reset{position:absolute;top:18px;right:20px;pointer-events:auto;background:rgba(0,0,0,.6);
  border:1px solid var(--pl-line);color:#e8e6e2;padding:9px 16px;border-radius:6px;cursor:pointer;font:inherit;font-size:12px;letter-spacing:.12em}
.pl-hint{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);color:#cfcac2;font-size:14px;
  background:rgba(0,0,0,.55);padding:8px 16px;border-radius:6px;max-width:60vw;text-align:center}
.pl-sab{position:absolute;right:20px;bottom:20px;pointer-events:auto;display:none;background:#2a0b0b;
  border:1px solid #7d2020;color:#ff8a7a;padding:14px 20px;border-radius:8px;cursor:pointer;font:inherit;
  font-size:13px;letter-spacing:.14em}
.pl-sab.on{display:block}
/* opacity:0 does NOT stop clicks — the hidden modal must be inert or it eats
   every click on the 3D canvas underneath it. */
.pl-modal{position:absolute;inset:0;background:rgba(0,0,0,.94);display:flex;align-items:center;justify-content:center;
  pointer-events:none;visibility:hidden;opacity:0;transition:opacity 1.1s ease;padding:40px}
.pl-modal.show{opacity:1;visibility:visible;pointer-events:auto}
.pl-card{max-width:620px;text-align:center}
.pl-card h1{font-size:15px;letter-spacing:.3em;color:#8c8880;margin:0 0 22px;font-weight:400}
.pl-card p{font-size:27px;line-height:1.5;color:#f2f0ec;margin:0 0 30px}
.pl-card small{font-size:12px;color:#6e6a63;letter-spacing:.12em}
.pl-turned{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 130px rgba(120,0,0,.42);opacity:0;transition:opacity 3s}
.pl-turned.on{opacity:1}
`;

export function mountPhoneUI(
  root: HTMLElement,
  opts: { role: Role; onSend: (t: string) => void; onReset: () => void }
): PhoneUI {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const warm = opts.role === "past";
  const el = document.createElement("div");
  el.className = "pl-root";
  el.style.setProperty("--pl-accent", warm ? "#e0a93b" : "#7fa8c9");
  el.style.setProperty("--pl-line", warm ? "rgba(224,169,59,.3)" : "rgba(127,168,201,.3)");
  el.style.setProperty("--pl-them", warm ? "rgba(224,169,59,.18)" : "rgba(127,168,201,.18)");

  el.innerHTML = `
    <div class="pl-turned"></div>
    <div class="pl-timer">05:00</div>
    <button class="pl-reset">RESET</button>
    <div class="pl-hint"></div>
    <div class="pl-phone">
      <div class="pl-phone-hd">${warm ? "1998 — LANDLINE" : "2026 — LANDLINE"}</div>
      <div class="pl-log"></div>
      <div class="pl-inrow">
        <input class="pl-in" placeholder="Say something..." maxlength="240" />
        <button class="pl-send">SEND</button>
      </div>
    </div>
    <button class="pl-sab">NAIL IT SHUT</button>
    <div class="pl-modal"><div class="pl-card"></div></div>
  `;
  root.appendChild(el);

  const $ = <T extends Element>(s: string) => el.querySelector(s) as T;
  const log = $<HTMLDivElement>(".pl-log");
  const input = $<HTMLInputElement>(".pl-in");
  const timerEl = $<HTMLDivElement>(".pl-timer");
  const hintEl = $<HTMLDivElement>(".pl-hint");
  const modal = $<HTMLDivElement>(".pl-modal");
  const card = $<HTMLDivElement>(".pl-card");
  const sab = $<HTMLButtonElement>(".pl-sab");
  const turned = $<HTMLDivElement>(".pl-turned");

  const send = () => {
    const t = input.value.trim();
    if (!t) return;
    opts.onSend(t);
    input.value = "";
  };
  $<HTMLButtonElement>(".pl-send").onclick = send;
  input.onkeydown = (e) => { if (e.key === "Enter") send(); };
  $<HTMLButtonElement>(".pl-reset").onclick = opts.onReset;
  modal.onclick = () => modal.classList.remove("show");

  let sabCb = () => {};

  return {
    renderMessages(msgs) {
      log.innerHTML = "";
      for (const m of msgs) {
        const d = document.createElement("div");
        d.className = "pl-msg " + (m.from === opts.role ? "pl-me" : "pl-them");
        d.textContent = m.text;
        log.appendChild(d);
      }
      log.scrollTop = log.scrollHeight;
    },
    setTimer(s) {
      const c = Math.max(0, Math.floor(s));
      timerEl.textContent =
        String(Math.floor(c / 60)).padStart(2, "0") + ":" + String(c % 60).padStart(2, "0");
      timerEl.classList.toggle("crit", c <= 60);
    },
    setPhase(p) {
      // Returning to "coop" means a reset happened — on EITHER client. Clear
      // every end-state artifact so the remote screen doesn't keep its card up.
      if (p === "coop") {
        modal.classList.remove("show");
        turned.classList.remove("on");
        sab.classList.remove("on");
      }
      // Only the past player's world curdles. The present player must not know.
      if (p === "turned" && opts.role === "past") {
        turned.classList.add("on");
        sab.classList.add("on");
      }
    },
    showObjectiveCard(title, body) {
      card.innerHTML =
        `<h1>${title}</h1><p>${body}</p><small>CLICK TO CONTINUE</small>`;
      modal.classList.add("show");
    },
    showEnding(type) {
      card.innerHTML =
        type === "escaped"
          ? `<h1>2026</h1><p>The door opens. You were told the truth.</p><small>CLICK TO CONTINUE</small>`
          : `<h1>2026</h1><p>The panel was sealed twenty-eight years ago.<br/>It was always going to be sealed.</p><small>CLICK TO CONTINUE</small>`;
      modal.classList.add("show");
    },
    setHint(t) { hintEl.textContent = t; },
    onSabotage(cb) { sabCb = cb; sab.onclick = () => sabCb(); },
    destroy() { el.remove(); style.remove(); },
  };
}
