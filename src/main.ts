import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createScene, type Era } from "./scene";
import { mountPhoneUI, type Msg } from "./ui/phone";
import { mountAudio } from "./audio";
import { mountAging } from "./effects/aging";
import "./style.css";

type Id = string;

const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
const lobby = document.getElementById("lobby") as HTMLDivElement;
const canvas = document.getElementById("c") as HTMLCanvasElement;
let audio: ReturnType<typeof mountAudio> | null = null;

// --- lobby ------------------------------------------------------------------
(document.getElementById("create") as HTMLButtonElement).onclick = async () => {
  const { sessionId, code } = await client.mutation(api.game.createSession, {});
  location.search = `?s=${sessionId}&role=past&code=${code}`;
};
(document.getElementById("join") as HTMLButtonElement).onclick = async () => {
  const code = (document.getElementById("code") as HTMLInputElement).value.trim().toUpperCase();
  if (!code) return;
  try {
    const sessionId = await client.mutation(api.game.joinSession, { code });
    location.search = `?s=${sessionId}&role=present`;
  } catch {
    const err = document.getElementById("err") as HTMLElement;
    err.textContent = "No game with that code.";
    err.classList.add("bad");
  }
};

const params = new URLSearchParams(location.search);
const sessionId = params.get("s") as Id | null;
const role = (params.get("role") || "past") as Era;

if (!sessionId) {
  lobby.style.display = "flex";
} else {
  lobby.style.display = "none";
  start(sessionId, role, params.get("code"));
}

// --- game -------------------------------------------------------------------
function start(sessionId: Id, role: Era, code: string | null) {
  const scene = createScene(canvas, role);
  const aging = mountAging(scene.three.scene, scene.three.camera, scene.three.renderer);
  audio = mountAudio(role);
  // Autoplay stays blocked until a real gesture; unlock on the first one we see.
  const unlockAudio = () => {
    audio?.unlock();
    audio?.setRoomTone(role);
    removeEventListener("pointerdown", unlockAudio);
    removeEventListener("keydown", unlockAudio);
  };
  addEventListener("pointerdown", unlockAudio);
  addEventListener("keydown", unlockAudio);
  audio.setRoomTone(role); // queued until unlock
  let world: Record<string, string> = {};
  let phase: "coop" | "turned" | "ended" = "coop";
  let timerEndsAt = Date.now() + 300000;
  let flipScheduled = false;
  let prevWorld: Record<string, string> | null = null;
  // Derived from server state, never stored locally: a refresh must not strand the key.
  const isHeld = () =>
    role === "past" ? world.brass_key === "held" : world.brass_key === "taken";
  let endShown = false;
  let trappedScheduled = false;

  const ui = mountPhoneUI(document.body, {
    role,
    onSend: (text) => client.mutation(api.game.sendMessage, { sessionId: sessionId as any, from: role, text }),
    onReset: async () => {
      await client.mutation(api.game.resetSession, { sessionId: sessionId as any });
      endShown = false;
      trappedScheduled = false;
      flipScheduled = false;
      scene.setHeld(null);
    },
  });

  if (code) ui.setCode(code);
  audio.playRing();

  ui.onSabotage(() => {
    client.mutation(api.game.actInPast, {
      sessionId: sessionId as any,
      objectKey: "wall_panel",
      newState: "nailed_shut",
    });
  });

  // --- live subscriptions: this is the time machine -------------------------
  client.onUpdate(api.game.getWorld, { sessionId: sessionId as any, era: role }, (rows: any[]) => {
    const next: Record<string, string> = {};
    for (const r of rows) next[r.key] = r.state;

    // The aging pulse fires on the PRESENT client only, on exactly two
    // transitions, and only against a previous state so it never misfires on
    // join. It must NEVER fire on sealed_away / sealed_painted_over: after a
    // sabotage her wall is deliberately identical to how it started, and a
    // bloom flash is the one thing that would tell her she has been betrayed.
    if (role === "present" && prevWorld) {
      if (prevWorld.wall_panel !== "gap_visible" && next.wall_panel === "gap_visible") {
        aging.pulse(scene.getVisual("wall_panel"));
      }
      if (prevWorld.brass_key !== "corroded_in_cavity" && next.brass_key === "corroded_in_cavity") {
        aging.pulse(scene.getVisual("brass_key"));
      }
    }
    prevWorld = next;
    world = next;
    scene.applyState(world);
    scene.setHeld(isHeld() ? "brass_key" : null);
    updateHint();

    // Sabotage landed: the key was sealed into the wall 28 years ago. The
    // present player cannot recover from this, so resolve rather than making
    // them wait out a five-minute timer.
    if (role === "present" && !trappedScheduled && world.brass_key === "sealed_away") {
      trappedScheduled = true;
      setTimeout(
        () => client.mutation(api.game.endGame, { sessionId: sessionId as any, endingType: "trapped" }),
        2600
      );
    }

    // The co-op beat landed. Let it breathe, then turn.
    if (role === "past" && !flipScheduled && world.brass_key === "in_cavity") {
      flipScheduled = true;
      setTimeout(() => client.mutation(api.game.flipPhase, { sessionId: sessionId as any }), 4500);
    }
  });

  client.onUpdate(api.game.getSession, { sessionId: sessionId as any }, (s: any) => {
    if (!s) return;
    timerEndsAt = s.timerEndsAt;
    if (s.phase !== phase) {
      phase = s.phase;
      ui.setPhase(phase);
      updateHint();
      // A reset can be pressed on either client; both must clear local latches.
      if (phase === "coop") {
        endShown = false;
        trappedScheduled = false;
        flipScheduled = false;
      }
      if (phase === "turned" && role === "past") {
        audio?.playStatic();
        ui.showObjectiveCard(
          "1998",
          "She doesn't know what happened in this house.<br/>She doesn't know it was you."
        );
      }
    }
    if (phase === "ended" && s.endingType && !endShown) {
      endShown = true;
      ui.showEnding(s.endingType);
    }
  });

  client.onUpdate(api.game.getMessages, { sessionId: sessionId as any }, (msgs: Msg[]) => {
    ui.renderMessages(msgs);
  });

  // --- interaction ----------------------------------------------------------
  scene.onPick((key) => {
    console.log("[rule]", { pickedKey: key, heldItem: isHeld() ? "brass_key" : null,
                            pastState: { ...world }, role, phase });
    if (phase === "ended") return;
    const act = (objectKey: string, newState: string) =>
      client.mutation(api.game.actInPast, { sessionId: sessionId as any, objectKey, newState });

    if (role === "past") {
      if (key === "brass_key" && world.brass_key === "on_counter") {
        act("brass_key", "held");
      } else if (key === "wall_panel" && world.wall_panel === "closed") {
        act("wall_panel", "open");
      } else if (key === "cavity" && isHeld()) {
        act("brass_key", "in_cavity");
      }
    } else {
      if (key === "brass_key" && world.brass_key === "corroded_in_cavity") {
        client.mutation(api.game.actInPresent, {
          sessionId: sessionId as any, objectKey: "brass_key", newState: "taken",
        });
      } else if (key === "door" && isHeld()) {
        client.mutation(api.game.endGame, { sessionId: sessionId as any, endingType: "escaped" });
      }
    }
    updateHint();
  });

  function updateHint() {
    if (phase === "ended") return ui.setHint("");
    if (role === "past") {
      if (phase === "turned") return ui.setHint("She is still talking to you.");
      if (world.brass_key === "in_cavity") return ui.setHint("It's in the wall. Tell her.");
      if (isHeld()) return ui.setHint("You're holding the key. The panel is behind the radiator.");
      if (world.wall_panel === "open") return ui.setHint("There's a cavity behind the panel.");
      return ui.setHint("Drag to look, WASD to move. Click to interact.");
    }
    if (isHeld()) return ui.setHint("You have the key. The door is on your right.");
    if (world.brass_key === "corroded_in_cavity") return ui.setHint("Something is in the wall.");
    if (world.wall_panel === "sealed_painted_over") return ui.setHint("The panel is sealed. It was always sealed.");
    return ui.setHint("The door is locked. Ask 1998 for help.");
  }

  // --- loop -----------------------------------------------------------------
  let lastFrame = performance.now();
  (function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    aging.update(dt);
    scene.render();
    const left = (timerEndsAt - Date.now()) / 1000;
    ui.setTimer(left);
    if (left <= 0 && (phase as string) !== "ended" && role === "present" && !endShown) {
      endShown = true;
      client.mutation(api.game.endGame, { sessionId: sessionId as any, endingType: "trapped" });
    }
  })();
}
