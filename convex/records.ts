import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { diffCounts, requireSession, requireTeacher } from "./helpers";
import { buildRecordSummary, syncRecordSummary } from "./recordSummaries";
import type { Doc, Id } from "./_generated/dataModel";

async function authorizedRecord(ctx: QueryCtx | MutationCtx, session: Doc<"sessions">, recordId: Id<"records">) {
  const record = await ctx.db.get(recordId);
  if (!record) throw new Error("기록을 찾을 수 없습니다.");
  if (session.role === "student" && record.studentId !== session.studentId) throw new Error("이 기록을 볼 권한이 없습니다.");
  return record;
}

function safeSearchTerm(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 16)
    .map((term) => Array.from(term).slice(0, 10).join(""))
    .filter(Boolean)
    .join(" ");
}

export const listMine = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await requireSession(ctx, sessionToken);
    if (session.role !== "student" || !session.studentId) throw new Error("학생 권한이 필요합니다.");
    const records = await ctx.db
      .query("records")
      .withIndex("by_student", (q) => q.eq("studentId", session.studentId!))
      .collect();
    const enriched = await Promise.all(records.map(async (record) => {
      const summary = await buildRecordSummary(ctx, record);
      return summary ? { ...record, ...summary, _id: record._id } : null;
    }));
    return enriched
      .filter((record): record is NonNullable<typeof record> => !!record)
      .sort((a, b) => a.subjectLabel.localeCompare(b.subjectLabel, "ko"));
  },
});

export const listSummaries = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireTeacher(ctx, sessionToken);
    return (await ctx.db.query("recordSummaries").collect())
      .map((summary) => ({ ...summary, _id: summary.recordId }))
      .sort((a, b) => a.classNumber - b.classNumber || a.studentNumber - b.studentNumber || a.subjectLabel.localeCompare(b.subjectLabel, "ko"));
  },
});

export const ensureSummaries = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireTeacher(ctx, sessionToken);
    const markerKey = "record-summaries-excel-lenb-v3";
    const marker = await ctx.db.query("appState").withIndex("by_key", (q) => q.eq("key", markerKey)).unique();
    if (marker?.value === "complete") return { created: 0, alreadyComplete: true };
    const records = await ctx.db.query("records").collect();
    for (const record of records) await syncRecordSummary(ctx, record);
    if (marker) await ctx.db.patch(marker._id, { value: "complete", updatedAt: Date.now() });
    else await ctx.db.insert("appState", { key: markerKey, value: "complete", updatedAt: Date.now() });
    return { created: records.length, alreadyComplete: false };
  },
});

export const searchContent = query({
  args: {
    sessionToken: v.string(),
    search: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { sessionToken, search, paginationOpts }) => {
    await requireTeacher(ctx, sessionToken);
    const term = safeSearchTerm(search);
    if (!term) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("records")
      .withSearchIndex("search_content", (q) => q.search("content", term))
      .paginate(paginationOpts);
    const page = await Promise.all(result.page.map(async (record) => {
      const existing = await ctx.db
        .query("recordSummaries")
        .withIndex("by_record", (q) => q.eq("recordId", record._id))
        .unique();
      const summary = existing ?? await buildRecordSummary(ctx, record);
      return summary ? { ...summary, _id: record._id, contentPreview: Array.from(record.content).slice(0, 160).join("") } : null;
    }));
    return { ...result, page: page.filter((item): item is NonNullable<typeof item> => !!item) };
  },
});

export const get = query({
  args: { sessionToken: v.string(), recordId: v.id("records") },
  handler: async (ctx, { sessionToken, recordId }) => {
    const session = await requireSession(ctx, sessionToken);
    const record = await authorizedRecord(ctx, session, recordId);
    const student = await ctx.db.get(record.studentId);
    const subject = await ctx.db.get(record.subjectId);
    return { ...record, studentName: student?.name ?? "", classNumber: student?.classNumber ?? 0, studentNumber: student?.studentNumber ?? 0, subjectLabel: subject?.label ?? "" };
  },
});

export const listHistories = query({
  args: { sessionToken: v.string(), recordId: v.id("records") },
  handler: async (ctx, { sessionToken, recordId }) => {
    const session = await requireSession(ctx, sessionToken);
    await authorizedRecord(ctx, session, recordId);
    const histories = await ctx.db.query("histories").withIndex("by_record", (q) => q.eq("recordId", recordId)).collect();
    return histories.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const update = mutation({
  args: { sessionToken: v.string(), recordId: v.id("records"), content: v.string() },
  handler: async (ctx, { sessionToken, recordId, content }) => {
    const session = await requireTeacher(ctx, sessionToken);
    const record = await authorizedRecord(ctx, session, recordId);
    if (record.content === content) return;
    const updatedAt = Date.now();
    await ctx.db.insert("histories", { recordId, beforeContent: record.content, afterContent: content, ...diffCounts(record.content, content), actorName: session.name, createdAt: updatedAt });
    await ctx.db.patch(recordId, { content, updatedAt });
    await syncRecordSummary(ctx, { ...record, content, updatedAt });
  },
});

export const restore = mutation({
  args: { sessionToken: v.string(), historyId: v.id("histories") },
  handler: async (ctx, { sessionToken, historyId }) => {
    const session = await requireTeacher(ctx, sessionToken);
    const history = await ctx.db.get(historyId);
    if (!history) throw new Error("수정 이력을 찾을 수 없습니다.");
    const record = await authorizedRecord(ctx, session, history.recordId);
    const content = history.afterContent;
    if (record.content === content) return;
    const updatedAt = Date.now();
    await ctx.db.insert("histories", { recordId: record._id, beforeContent: record.content, afterContent: content, ...diffCounts(record.content, content), actorName: `${session.name} (되돌리기)`, createdAt: updatedAt });
    await ctx.db.patch(record._id, { content, updatedAt });
    await syncRecordSummary(ctx, { ...record, content, updatedAt });
  },
});
