// Overlay UI. Exported signature is frozen — if a teammate's HUD replaces this
// file it must keep mountPhoneUI's shape and the returned method set.
//
// Hard rule learned the expensive way: the root is pointer-events:none and only
// genuinely interactive chrome opts back in. A full-screen element at opacity:0
// still swallows every click on the 3D canvas underneath it.

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
  setCode(code: string): void;
  onSabotage(cb: () => void): void;
  destroy(): void;
}

const TOTAL_SECONDS = 300;

const CSS = `
.pl-root{
  position:fixed;inset:0;pointer-events:none;z-index:10;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --serif:"Iowan Old Style","Palatino Linotype",Georgia,serif;
  color:var(--ink);
}
.pl-root *{box-sizing:border-box;margin:0}

/* Always-on vignette. Sells "you are inside a room", costs nothing. */
.pl-vig{position:absolute;inset:0;pointer-events:none;
  box-shadow:inset 0 0 200px 40px var(--vig);opacity:.85}

/* ---- era badge, top left ------------------------------------------------ */
.pl-era{position:absolute;top:26px;left:30px;line-height:1}
.pl-year{font:400 46px/1 var(--mono);letter-spacing:.22em;color:var(--accent);opacity:.5}
.pl-place{margin-top:8px;font:400 10px/1 var(--mono);letter-spacing:.34em;
  color:var(--ink-dim);text-transform:uppercase}

/* ---- timer, top centre -------------------------------------------------- */
.pl-timerwrap{position:absolute;top:30px;left:50%;transform:translateX(-50%);
  display:flex;flex-direction:column;align-items:center;gap:9px}
.pl-timer{font:400 40px/1 var(--mono);letter-spacing:.12em;color:var(--ink);
  text-shadow:0 2px 26px rgba(0,0,0,.9);font-variant-numeric:tabular-nums}
.pl-bar{width:172px;height:1px;background:var(--rule);overflow:hidden}
.pl-bar i{display:block;height:100%;width:100%;background:var(--accent);
  transform-origin:left center;transition:transform .9s linear;opacity:.75}
.pl-timerwrap.crit .pl-timer{color:#ff6a55;animation:plpulse 1s steps(2,end) infinite}
.pl-timerwrap.crit .pl-bar i{background:#ff6a55;opacity:1}
@keyframes plpulse{50%{opacity:.3}}

/* ---- reset, top right. Required to be visible, not required to shout. --- */
.pl-reset{position:absolute;top:32px;right:30px;pointer-events:auto;
  background:transparent;border:1px solid var(--rule);color:var(--ink-dim);
  padding:8px 15px;border-radius:2px;cursor:pointer;
  font:400 10px/1 var(--mono);letter-spacing:.26em;
  transition:color .2s,border-color .2s}
.pl-reset:hover{color:var(--ink);border-color:var(--accent)}

/* ---- the phone, bottom left -------------------------------------------- */
.pl-phone{position:absolute;left:30px;bottom:30px;width:340px;max-height:44vh;
  display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;
  background:linear-gradient(180deg,var(--panel-hi),var(--panel));
  border:1px solid var(--rule);border-radius:3px;
  box-shadow:0 26px 60px rgba(0,0,0,.62)}
.pl-hd{display:flex;align-items:center;gap:9px;padding:11px 14px;
  border-bottom:1px solid var(--rule);
  font:400 10px/1 var(--mono);letter-spacing:.24em;color:var(--ink-dim)}
.pl-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 9px var(--accent);animation:plbreathe 2.6s ease-in-out infinite}
@keyframes plbreathe{0%,100%{opacity:1}50%{opacity:.28}}
.pl-hd .sp{margin-left:auto;letter-spacing:.2em;opacity:.62}
.pl-code{display:none;margin-left:auto;padding:4px 9px;border:1px solid var(--accent);
  border-radius:2px;color:var(--accent);font:400 11px/1 var(--mono);letter-spacing:.34em;
  text-indent:.34em;background:rgba(0,0,0,.35)}
.pl-code.on{display:inline-block;animation:plin .6s ease both}
.pl-code.on + .sp{margin-left:10px}

.pl-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;
  gap:11px;min-height:132px;scrollbar-width:thin}
.pl-log:empty::after{content:"The line is open.";color:var(--ink-dim);
  font:400 12px/1 var(--mono);letter-spacing:.1em;margin:auto;opacity:.5}
.pl-msg{max-width:86%;padding:8px 12px;border-radius:3px;
  font:400 14px/1.45 var(--mono);word-break:break-word}
.pl-them{align-self:flex-start;background:var(--bubble-them);
  color:var(--ink);border-left:2px solid var(--accent)}
.pl-me{align-self:flex-end;background:rgba(255,255,255,.055);color:var(--ink-dim)}

.pl-inrow{display:flex;align-items:center;border-top:1px solid var(--rule);
  background:rgba(0,0,0,.28)}
.pl-in{flex:1;background:transparent;border:0;outline:0;color:var(--ink);
  padding:13px 14px;font:400 14px/1 var(--mono)}
.pl-in::placeholder{color:var(--ink-dim);opacity:.55}
.pl-send{background:transparent;border:0;color:var(--accent);cursor:pointer;
  padding:13px 15px;font:400 10px/1 var(--mono);letter-spacing:.24em;opacity:.8}
.pl-send:hover{opacity:1}

/* ---- hint. Hidden entirely when empty, or it renders as a dead pill. ---- */
.pl-hint{position:absolute;bottom:44px;left:50%;transform:translateX(-50%);
  font:400 14px/1.5 var(--serif);font-style:italic;color:var(--ink);
  letter-spacing:.02em;max-width:46ch;text-align:center;
  text-shadow:0 2px 18px rgba(0,0,0,.95);transition:opacity .35s}
.pl-hint:empty{display:none}

/* ---- sabotage ----------------------------------------------------------- */
.pl-sab{position:absolute;right:30px;bottom:30px;pointer-events:auto;display:none;
  background:rgba(46,8,8,.9);border:1px solid #8c2622;color:#ff9484;
  padding:15px 22px;border-radius:3px;cursor:pointer;
  font:400 11px/1 var(--mono);letter-spacing:.26em;
  box-shadow:0 0 34px rgba(150,20,20,.3);transition:background .2s,color .2s}
.pl-sab:hover{background:rgba(74,12,12,.96);color:#ffc4b8}
.pl-sab.on{display:block;animation:plin .8s ease both}
@keyframes plin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ---- cards -------------------------------------------------------------- */
.pl-modal{position:absolute;inset:0;display:flex;align-items:center;
  justify-content:center;padding:6vw;background:rgba(4,4,6,.955);
  pointer-events:none;visibility:hidden;opacity:0;transition:opacity 1.15s ease}
.pl-modal.show{opacity:1;visibility:visible;pointer-events:auto}
/* The two endings must not look the same. Escape is warm and lifts; trapped
   is cold and closes in. */
.pl-modal.end-escaped{background:radial-gradient(ellipse at 50% 40%,rgba(64,48,18,.96),rgba(6,5,4,.98) 70%)}
.pl-modal.end-trapped{background:radial-gradient(ellipse at 50% 60%,rgba(10,16,22,.97),rgba(2,3,5,.995) 70%)}
.pl-modal.show .pl-card h1{animation:plreveal .9s .15s ease both}
.pl-modal.show .pl-card p{animation:plreveal 1.1s .35s ease both}
.pl-modal.show .pl-card small{animation:plreveal 1s 1.1s ease both}
@keyframes plreveal{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pl-card{max-width:660px;text-align:center}
.pl-card h1{font:400 11px/1 var(--mono);letter-spacing:.5em;color:var(--ink-dim);
  margin-bottom:30px;text-transform:uppercase}
.pl-card p{font:400 30px/1.48 var(--serif);color:#f4f2ee;margin-bottom:36px}
.pl-card small{font:400 9px/1 var(--mono);letter-spacing:.3em;color:var(--ink-dim);
  opacity:.6;text-transform:uppercase}

/* ---- the turn. Past client only. --------------------------------------- */
.pl-turned{position:absolute;inset:0;pointer-events:none;opacity:0;
  transition:opacity 3.4s ease;
  box-shadow:inset 0 0 190px 30px rgba(104,0,0,.5)}
.pl-turned.on{opacity:1}

/* ---- era palettes ------------------------------------------------------- */
.pl-past{
  --ink:#f2e6d2;--ink-dim:#a8927a;--accent:#e8a63c;
  --rule:rgba(232,166,60,.26);--panel:rgba(26,18,10,.9);
  --panel-hi:rgba(44,31,17,.9);--bubble-them:rgba(232,166,60,.14);
  --vig:rgba(28,14,2,.72);
}
.pl-present{
  --ink:#dfe6ec;--ink-dim:#7b8792;--accent:#79b6d9;
  --rule:rgba(121,182,217,.24);--panel:rgba(10,14,18,.9);
  --panel-hi:rgba(20,27,34,.9);--bubble-them:rgba(121,182,217,.14);
  --vig:rgba(2,5,9,.78);
}
`;

export function mountPhoneUI(
  root: HTMLElement,
  opts: { role: Role; onSend: (t: string) => void; onReset: () => void }
): PhoneUI {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const past = opts.role === "past";
  const el = document.createElement("div");
  el.className = "pl-root " + (past ? "pl-past" : "pl-present");

  el.innerHTML = `
    <div class="pl-vig"></div>
    <div class="pl-turned"></div>

    <div class="pl-era">
      <div class="pl-year">${past ? "1998" : "2026"}</div>
      <div class="pl-place">${past ? "The kitchen" : "Twenty-eight years later"}</div>
    </div>

    <div class="pl-timerwrap">
      <div class="pl-timer">05:00</div>
      <div class="pl-bar"><i></i></div>
    </div>

    <button class="pl-reset">RESET</button>

    <div class="pl-phone">
      <div class="pl-hd">
        <span class="pl-dot"></span><span>LINE OPEN</span>
        <span class="pl-code"></span>
        <span class="sp">${past ? "1998" : "2026"}</span>
      </div>
      <div class="pl-log"></div>
      <div class="pl-inrow">
        <input class="pl-in" placeholder="Say something..." maxlength="240" />
        <button class="pl-send">SEND</button>
      </div>
    </div>

    <div class="pl-hint"></div>
    <button class="pl-sab">NAIL IT SHUT</button>
    <div class="pl-modal"><div class="pl-card"></div></div>
  `;
  root.appendChild(el);

  const $ = <T extends Element>(s: string) => el.querySelector(s) as T;
  const log = $<HTMLDivElement>(".pl-log");
  const input = $<HTMLInputElement>(".pl-in");
  const timerWrap = $<HTMLDivElement>(".pl-timerwrap");
  const timerEl = $<HTMLDivElement>(".pl-timer");
  const barFill = $<HTMLElement>(".pl-bar i");
  const hintEl = $<HTMLDivElement>(".pl-hint");
  const modal = $<HTMLDivElement>(".pl-modal");
  const card = $<HTMLDivElement>(".pl-card");
  const sab = $<HTMLButtonElement>(".pl-sab");
  const turned = $<HTMLDivElement>(".pl-turned");
  const codeEl = $<HTMLSpanElement>(".pl-code");

  const send = () => {
    const t = input.value.trim();
    if (!t) return;
    opts.onSend(t);
    input.value = "";
  };
  $<HTMLButtonElement>(".pl-send").onclick = send;
  input.onkeydown = (e) => {
    if (e.key === "Enter") send();
    e.stopPropagation(); // typing "w"/"a"/"s"/"d" must not walk the room
  };
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
      barFill.style.transform = `scaleX(${Math.max(0, Math.min(1, c / TOTAL_SECONDS))})`;
      timerWrap.classList.toggle("crit", c <= 60);
    },

    setPhase(p) {
      // Back to "coop" means a reset happened, possibly on the OTHER client.
      // Clear every end-state artifact or the remote screen keeps its card up.
      if (p === "coop") {
        modal.classList.remove("show", "end-escaped", "end-trapped");
        turned.classList.remove("on");
        sab.classList.remove("on");
      }
      // Only the past player's world curdles. The present player must not know.
      if (p === "turned" && past) {
        turned.classList.add("on");
        sab.classList.add("on");
      }
    },

    showObjectiveCard(title, body) {
      modal.classList.remove("end-escaped", "end-trapped");
      card.innerHTML = `<h1>${title}</h1><p>${body}</p><small>Click to continue</small>`;
      modal.classList.add("show");
    },

    showEnding(type) {
      modal.classList.remove("end-escaped", "end-trapped");
      modal.classList.add(type === "escaped" ? "end-escaped" : "end-trapped");
      card.innerHTML =
        type === "escaped"
          ? `<h1>2026</h1><p>The door opens.<br/>You were told the truth.</p><small>Click to continue</small>`
          : `<h1>2026</h1><p>The panel was sealed twenty-eight years ago.<br/>It was always going to be sealed.</p><small>Click to continue</small>`;
      modal.classList.add("show");
    },

    setHint(t) { hintEl.textContent = t; },
    setCode(c) {
      codeEl.textContent = c;
      codeEl.classList.toggle("on", !!c);
    },
    onSabotage(cb) { sabCb = cb; sab.onclick = () => sabCb(); },
    destroy() { el.remove(); style.remove(); },
  };
}
