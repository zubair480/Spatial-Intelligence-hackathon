import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { CAUSALITY, INITIAL_STATE, TIMER_MS, type Consequence } from "./causality";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

export const createSession = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const code = makeCode();
    const sessionId = await ctx.db.insert("sessions", {
      code,
      phase: "coop",
      startedAt: now,
      timerEndsAt: now + TIMER_MS,
    });

    for (const [era, objs] of Object.entries(INITIAL_STATE)) {
      for (const [key, state] of Object.entries(objs)) {
        await ctx.db.insert("objects", {
          sessionId,
          key,
          era: era as "past" | "present",
          state,
        });
      }
    }

    return { sessionId, code };
  },
});

export const joinSession = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", code.toUpperCase()))
      .first();
    if (!session) throw new Error("No session with code " + code);
    return session._id;
  },
});

export const getSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => await ctx.db.get(sessionId),
});

export const getWorld = query({
  args: {
    sessionId: v.id("sessions"),
    era: v.union(v.literal("past"), v.literal("present")),
  },
  handler: async (ctx, { sessionId, era }) =>
    await ctx.db
      .query("objects")
      .withIndex("by_session_era", (q) =>
        q.eq("sessionId", sessionId).eq("era", era)
      )
      .collect(),
});

export const getMessages = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    await ctx.db
      .query("messages")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

// ---------------------------------------------------------------------------
// THE FUNCTION THAT IS THE GAME.
// One mutation. One transaction. Writes the past row AND every present row it
// causes, so the present player's subscription fires once and their world
// visibly changes while they are looking at it.
// ---------------------------------------------------------------------------
export const actInPast = mutation({
  args: {
    sessionId: v.id("sessions"),
    objectKey: v.string(),
    newState: v.string(),
  },
  handler: async (ctx, { sessionId, objectKey, newState }) => {
    const pastRow = await ctx.db
      .query("objects")
      .withIndex("by_session_key_era", (q) =>
        q.eq("sessionId", sessionId).eq("key", objectKey).eq("era", "past")
      )
      .first();
    if (!pastRow) throw new Error("No past object " + objectKey);

    await ctx.db.patch(pastRow._id, { state: newState });

    const raw = CAUSALITY[`${objectKey}:${newState}`];
    if (!raw) return { consequences: 0 };
    const consequences: Consequence[] = Array.isArray(raw) ? raw : [raw];

    for (const c of consequences) {
      const presentRow = await ctx.db
        .query("objects")
        .withIndex("by_session_key_era", (q) =>
          q.eq("sessionId", sessionId).eq("key", c.key).eq("era", "present")
        )
        .first();
      if (presentRow) await ctx.db.patch(presentRow._id, { state: c.state });
    }

    return { consequences: consequences.length };
  },
});

// Present-side actions never rewrite history; they only consume it.
export const actInPresent = mutation({
  args: {
    sessionId: v.id("sessions"),
    objectKey: v.string(),
    newState: v.string(),
  },
  handler: async (ctx, { sessionId, objectKey, newState }) => {
    const row = await ctx.db
      .query("objects")
      .withIndex("by_session_key_era", (q) =>
        q.eq("sessionId", sessionId).eq("key", objectKey).eq("era", "present")
      )
      .first();
    if (!row) throw new Error("No present object " + objectKey);
    await ctx.db.patch(row._id, { state: newState });
  },
});

export const sendMessage = mutation({
  args: {
    sessionId: v.id("sessions"),
    from: v.union(v.literal("past"), v.literal("present")),
    text: v.string(),
  },
  handler: async (ctx, { sessionId, from, text }) => {
    const clean = text.trim().slice(0, 240);
    if (!clean) return;
    await ctx.db.insert("messages", { sessionId, from, text: clean, at: Date.now() });
  },
});

export const flipPhase = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    await ctx.db.patch(sessionId, { phase: "turned" });
  },
});

export const endGame = mutation({
  args: {
    sessionId: v.id("sessions"),
    endingType: v.union(v.literal("escaped"), v.literal("trapped")),
  },
  handler: async (ctx, { sessionId, endingType }) => {
    await ctx.db.patch(sessionId, { phase: "ended", endingType });
  },
});

export const resetSession = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const now = Date.now();
    await ctx.db.patch(sessionId, {
      phase: "coop",
      endingType: undefined,
      startedAt: now,
      timerEndsAt: now + TIMER_MS,
    });

    const objs = await ctx.db
      .query("objects")
      .withIndex("by_session_era", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const o of objs) {
      const era = o.era as "past" | "present";
      const want = (INITIAL_STATE[era] as Record<string, string>)[o.key];
      if (want && o.state !== want) await ctx.db.patch(o._id, { state: want });
    }

    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const m of msgs) await ctx.db.delete(m._id);
  },
});
