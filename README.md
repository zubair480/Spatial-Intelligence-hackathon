# PARTY LINE

**Two players. One house. Twenty-eight years apart.**

Built at the Spatial Intelligence + Generative 3D Hackathon — Founders Inc, San Francisco, 5 September 2026.
Track: **Gaming & Interactive Worlds**.

---

## The idea

One player is in a kitchen in **1998**. The other is in the **same kitchen in 2026** — same layout,
twenty-eight years of decay. They cannot see each other's screen. All they share is a phone line.

What the 1998 player does to the room **rewrites the 2026 player's world while they are standing in it.**
Tell 1998 to hide a key in the wall cavity, and a corroded key materialises behind a twenty-eight-year-old
radiator — from 2026's point of view it has been in that wall their whole life.

Then, partway through, the 1998 player privately receives a card the other never sees:

> *She doesn't know what happened in this house. She doesn't know it was you.*

From that moment they can seal the wall instead, and lie about it on the phone. The 2026 player only ever
sees consequences, never actions. They have no way to know.

## Why the mechanic is the architecture

The time travel is not an effect. **It is the database.**

`actInPast` writes the past-era row *and* every present-era row it causes in a **single Convex
transaction**, so the other client's live subscription fires once and their world visibly changes
mid-sentence. Convex's reactivity *is* the conceit — not plumbing underneath it.

```ts
// convex/causality.ts — the whole game, as data
"wall_panel:open"        -> [{ wall_panel, gap_visible }]
"brass_key:in_cavity"    -> [{ brass_key,  corroded_in_cavity }]
"wall_panel:nailed_shut" -> [{ wall_panel, sealed_painted_over },
                             { brass_key,  sealed_away }]        // the betrayal
```

The sabotage writes **two** rows atomically: the wall is sealed *and* the key is gone, together, in the
past — so in the present it was never there at all.

## Tech

| | |
|---|---|
| **Convex** | Reactive backend. The time machine itself — one transaction, two timelines. |
| **World Labs / Marble** | Reference worlds for both eras of the house. |
| **Tripo** | The objects that cross time — the key, new in 1998 and weathered by 2026. |
| **Three.js + Vite + TypeScript** | Renderer and client. No framework. |

## Run it

```bash
npm install
npx convex dev     # local anonymous deployment, no login needed
npm run dev
```

Open two windows side by side. **START A GAME** puts you in 1998 and gives you a four-letter code;
**JOIN** with that code puts the other player in 2026.

## Notes on the build

- Picking never reads `mesh.visible`. An explicit `activeTargets` set is recomputed on every state
  change, so only currently-actionable objects can be hit — the fix for a class of silent no-op clicks.
- Interaction runs off invisible oversized hit proxies, independent of the visual meshes, so swapping
  in generated models can never regress the click targets.
- `applyState` is fully declarative, never accumulative — otherwise a reset leaves the panel darkened
  from a previous sabotage and quietly telegraphs the twist.
- Audio degrades silently if assets are absent.
