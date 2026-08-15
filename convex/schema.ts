import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  students: defineTable({
    classNumber: v.number(),
    studentNumber: v.number(),
    name: v.string(),
    codeHash: v.string(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]).index("by_class_number", ["classNumber", "studentNumber"]),
  subjects: defineTable({
    label: v.string(),
    createdAt: v.number(),
  }).index("by_label", ["label"]),
  records: defineTable({
    studentId: v.id("students"),
    subjectId: v.id("subjects"),
    content: v.string(),
    updatedAt: v.number(),
  })
    .index("by_student", ["studentId"])
    .index("by_subject", ["subjectId"])
    .index("by_student_subject", ["studentId", "subjectId"])
    .searchIndex("search_content", { searchField: "content" }),
  recordSummaries: defineTable({
    recordId: v.id("records"),
    studentId: v.id("students"),
    subjectId: v.id("subjects"),
    classNumber: v.number(),
    studentNumber: v.number(),
    studentName: v.string(),
    subjectLabel: v.string(),
    contentBytes: v.number(),
    updatedAt: v.number(),
  })
    .index("by_record", ["recordId"])
    .index("by_student", ["studentId"])
    .index("by_subject", ["subjectId"]),
  histories: defineTable({
    recordId: v.id("records"),
    beforeContent: v.string(),
    afterContent: v.string(),
    addedCount: v.number(),
    removedCount: v.number(),
    actorName: v.string(),
    createdAt: v.number(),
  }).index("by_record", ["recordId"]),
  sessions: defineTable({
    token: v.string(),
    role: v.union(v.literal("student"), v.literal("teacher")),
    name: v.string(),
    studentId: v.optional(v.id("students")),
    expiresAt: v.number(),
  }).index("by_token", ["token"]).index("by_expires_at", ["expiresAt"]),
  loginAttempts: defineTable({
    key: v.string(),
    attempts: v.number(),
    windowStartedAt: v.number(),
    blockedUntil: v.optional(v.number()),
  }).index("by_key", ["key"]),
  appState: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
