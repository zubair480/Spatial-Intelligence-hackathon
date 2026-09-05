import * as THREE from "three";

export type Era = "past" | "present";
export type ObjState = Record<string, string>;

// ---------------------------------------------------------------------------
// Era palettes. 1998 is warm and lived-in. 2026 is cold and abandoned.
// ---------------------------------------------------------------------------
const PALETTE = {
  past: {
    wall: 0xd8c9a8,
    floor: 0x8a6a45,
    ceiling: 0xe8ddc4,
    counter: 0xb9a179,
    radiator: 0xe0dacc,
    panel: 0xc9b492,
    key: 0xe0a93b,
    door: 0x9a7248,
    light: 0xffd9a0,
    lightI: 1.15,
    ambientI: 0.55,
    fog: 0x1a120a,
  },
  present: {
    wall: 0x5d6168,
    floor: 0x3a3d42,
    ceiling: 0x4a4e55,
    counter: 0x4e5158,
    radiator: 0x6b5545,
    panel: 0x565a60,
    key: 0x7d6a4a,
    door: 0x44474d,
    light: 0xbcd2e8,
    lightI: 0.7,
    ambientI: 0.3,
    fog: 0x0a0c10,
  },
} as const;

export interface SceneHandle {
  render(): void;
  applyState(state: ObjState): void;
  onPick(cb: (key: string) => void): void;
  setHeld(key: string | null): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement, era: Era): SceneHandle {
  const P = PALETTE[era];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(P.fog);
  scene.fog = new THREE.Fog(P.fog, 6, 18);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 3.2);

  scene.add(new THREE.AmbientLight(P.light, P.ambientI));
  const lamp = new THREE.PointLight(P.light, P.lightI, 22, 1.4);
  lamp.position.set(0, 2.6, 0.5);
  scene.add(lamp);

  // --- room shell -----------------------------------------------------------
  const W = 8, H = 3, D = 8;
  const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(P.floor));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(P.ceiling));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  scene.add(ceil);

  const wallGeo = new THREE.PlaneGeometry(W, H);
  const back = new THREE.Mesh(wallGeo, mat(P.wall));
  back.position.set(0, H / 2, -D / 2);
  scene.add(back);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(D, H), mat(P.wall));
  left.rotation.y = Math.PI / 2;
  left.position.set(-W / 2, H / 2, 0);
  scene.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(D, H), mat(P.wall));
  right.rotation.y = -Math.PI / 2;
  right.position.set(W / 2, H / 2, 0);
  scene.add(right);

  // --- interactables --------------------------------------------------------
  // Every interactable gets a generous INVISIBLE hit proxy that tracks it.
  // Clicking a 22cm key across a room is not a skill the demo should test.
  const pickable: THREE.Mesh[] = [];
  const proxyOf = new Map<THREE.Mesh, THREE.Mesh>(); // proxy -> visual
  const proxyByKey = new Map<string, THREE.Mesh>(); // objectKey -> proxy
  const HITMAT = new THREE.MeshBasicMaterial({ visible: false });
  const reg = (m: THREE.Mesh, key: string, hit: [number, number, number]) => {
    scene.add(m);
    const p = new THREE.Mesh(new THREE.BoxGeometry(...hit), HITMAT);
    p.userData.key = key;
    p.name = key;
    m.name = key + "_visual";
    scene.add(p);
    pickable.push(p);
    proxyOf.set(p, m);
    proxyByKey.set(key, p);
    return m;
  };

  // counter
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.7), mat(P.counter));
  counter.position.set(-2.2, 0.45, -3.2);
  scene.add(counter);

  // radiator on the back wall
  const radiator = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.22), mat(P.radiator));
  radiator.position.set(1.6, 0.5, -3.75);
  scene.add(radiator);

  // wall panel behind the radiator
  const panel = reg(
    new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.08), mat(P.panel)),
    "wall_panel",
    [1.5, 1.3, 0.6]
  );
  panel.position.set(1.6, 1.45, -3.92);

  // the cavity revealed when the panel opens
  const cavity = reg(
    new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.05), mat(0x0b0b0d)),
    "cavity",
    [1.4, 1.2, 0.5]
  );
  cavity.position.set(1.6, 1.45, -3.95);
  cavity.visible = false;

  // brass key
  const key = reg(
    new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.07), mat(P.key)),
    "brass_key",
    [0.75, 0.6, 0.75]
  );
  key.material = new THREE.MeshStandardMaterial({
    color: P.key,
    roughness: era === "past" ? 0.35 : 0.95,
    metalness: era === "past" ? 0.85 : 0.25,
  });
  const KEY_ON_COUNTER = new THREE.Vector3(-2.2, 0.95, -3.1);
  const KEY_IN_CAVITY = new THREE.Vector3(1.6, 1.4, -3.86);
  key.position.copy(KEY_ON_COUNTER);

  // door
  const door = reg(
    new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.1, 1.0), mat(P.door)),
    "door",
    [0.9, 2.3, 1.4]
  );
  door.position.set(W / 2 - 0.06, 1.05, 1.2);

  // held-item indicator floating near the camera
  const heldMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.022, 0.028),
    new THREE.MeshStandardMaterial({ color: P.key, metalness: 0.8, roughness: 0.3 })
  );
  heldMesh.visible = false;
  scene.add(heldMesh);

  // --- actionable targets ---------------------------------------------------
  // We never raycast the whole scene and never rely on mesh.visible. The set of
  // clickable proxies is derived from era state + held item and recomputed the
  // moment either changes, so a click can never hit a stale or non-actionable
  // target. This is what made the cavity click silently resolve to wall_panel.
  let curState: ObjState = {};
  let heldItem: string | null = null;
  const activeTargets: THREE.Object3D[] = [];

  function recomputeTargets() {
    activeTargets.length = 0;
    const s = curState;
    const add = (k: string) => {
      const m = proxyByKey.get(k);
      if (m) activeTargets.push(m);
    };
    if (era === "past") {
      if (s.brass_key === "on_counter") add("brass_key");
      if (s.wall_panel === "closed") add("wall_panel");
      if (s.wall_panel === "open" && heldItem === "brass_key") add("cavity");
    } else {
      if (s.brass_key === "corroded_in_cavity") add("brass_key");
      if (s.brass_key === "taken") add("door");
    }
  }

  // --- state -> visuals -----------------------------------------------------
  function applyState(state: ObjState) {
    curState = state;
    recomputeTargets();
    const k = state.brass_key;
    const p = state.wall_panel;

    // panel. Every branch sets colour explicitly: applyState must be fully
    // declarative, never accumulative, or a reset leaves the panel darkened
    // from a previous sabotage and quietly telegraphs the twist.
    const sealed = p === "nailed_shut" || p === "sealed_painted_over";
    const open = p === "open" || p === "gap_visible";
    panel.visible = sealed || !open;
    cavity.visible = !sealed && open;
    (panel.material as THREE.MeshStandardMaterial).color.setHex(
      sealed ? (era === "past" ? 0x8a7a5e : 0x3c3f45) : P.panel
    );

    // key
    const km = key.material as THREE.MeshStandardMaterial;
    if (k === "corroded_in_cavity") {
      km.color.setHex(0x6f5c3a);
      km.roughness = 1.0;
      km.metalness = 0.1;
    } else {
      km.color.setHex(P.key);
      km.roughness = era === "past" ? 0.35 : 0.95;
      km.metalness = era === "past" ? 0.85 : 0.25;
    }
    if (k === "on_counter") {
      key.visible = true;
      key.position.copy(KEY_ON_COUNTER);
    } else if (k === "in_cavity" || k === "corroded_in_cavity") {
      key.visible = true;
      key.position.copy(KEY_IN_CAVITY);
    } else {
      key.visible = false;
    }

    // door hint
    (door.material as THREE.MeshStandardMaterial).emissive.setHex(
      k === "taken" ? 0x2b2a18 : 0x000000
    );
  }

  function setHeld(k: string | null) {
    heldItem = k;
    heldMesh.visible = k === "brass_key";
    recomputeTargets();
  }

  // --- picking --------------------------------------------------------------
  let pickCb: (key: string) => void = () => {};
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let hovered: THREE.Mesh | null = null;
  function pickAt(x: number, y: number): THREE.Mesh | null {
    ndc.x = (x / innerWidth) * 2 - 1;
    ndc.y = -(y / innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(activeTargets, false);
    return hits.length ? (hits[0].object as THREE.Mesh) : null;
  }

  function setHover(proxy: THREE.Mesh | null) {
    if (hovered === proxy) return;
    if (hovered) {
      const v = proxyOf.get(hovered);
      if (v) (v.material as THREE.MeshStandardMaterial).emissive?.setHex(0x000000);
    }
    hovered = proxy;
    if (hovered) {
      const v = proxyOf.get(hovered);
      if (v) (v.material as THREE.MeshStandardMaterial).emissive?.setHex(0x3a3320);
    }
    canvas.style.cursor = hovered ? "pointer" : "default";
  }

  function onClick(e: MouseEvent) {
    ndc.x = (e.clientX / innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(activeTargets, false);
    console.log("[pick] activeTargets=", activeTargets.map(o => o.name),
                "hits=", hits.map(h => h.object.name));
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) pickCb(hit.userData.key as string);
  }
  canvas.addEventListener("click", onClick);

  // --- look controls: drag to look, WASD to move ---------------------------
  let yaw = 0, pitch = 0, dragging = false, lx = 0, ly = 0;
  const keys = new Set<string>();
  canvas.addEventListener("mousedown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  addEventListener("mouseup", () => (dragging = false));
  addEventListener("mousemove", (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lx) * 0.004;
    pitch = Math.max(-1.1, Math.min(1.1, pitch - (e.clientY - ly) * 0.004));
    lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!dragging) setHover(pickAt(e.clientX, e.clientY));
  });
  addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  function render() {
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const strafe = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const sp = 0.055;
    if (keys.has("w")) camera.position.addScaledVector(fwd, sp);
    if (keys.has("s")) camera.position.addScaledVector(fwd, -sp);
    if (keys.has("a")) camera.position.addScaledVector(strafe, -sp);
    if (keys.has("d")) camera.position.addScaledVector(strafe, sp);
    camera.position.x = Math.max(-W / 2 + 0.5, Math.min(W / 2 - 0.5, camera.position.x));
    camera.position.z = Math.max(-D / 2 + 0.5, Math.min(D / 2 - 0.5, camera.position.z));
    camera.position.y = 1.6;

    for (const [p, v] of proxyOf) p.position.copy(v.position);

    camera.rotation.set(pitch, yaw, 0, "YXZ");
    heldMesh.position.copy(camera.position)
      .addScaledVector(fwd, 0.42)
      .addScaledVector(strafe, 0.19);
    heldMesh.position.y = camera.position.y - 0.16;
    heldMesh.rotation.set(0.3, yaw + 0.5, 0.15);

    renderer.render(scene, camera);
  }

  return {
    render,
    applyState,
    setHeld,
    onPick: (cb) => (pickCb = cb),
    dispose: () => {
      canvas.removeEventListener("click", onClick);
      renderer.dispose();
    },
  };
}
