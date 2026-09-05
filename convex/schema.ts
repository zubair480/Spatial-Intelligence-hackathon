import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    code: v.string(),
    phase: v.union(v.literal("coop"), v.literal("turned"), v.literal("ended")),
    endingType: v.optional(v.union(v.literal("escaped"), v.literal("trapped"))),
    startedAt: v.number(),
    timerEndsAt: v.number(),
  }).index("by_code", ["code"]),

  objects: defineTable({
    sessionId: v.id("sessions"),
    key: v.string(),
    era: v.union(v.literal("past"), v.literal("present")),
    state: v.string(),
  })
    .index("by_session_era", ["sessionId", "era"])
    .index("by_session_key_era", ["sessionId", "key", "era"]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    from: v.union(v.literal("past"), v.literal("present")),
    text: v.string(),
    at: v.number(),
  }).index("by_session", ["sessionId"]),
});
