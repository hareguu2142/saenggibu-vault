import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type ReadCtx = QueryCtx | MutationCtx;

export function neatBytes(content: string) {
  const chars = Array.from(content).length;
  let lenB = 0;
  for (const ch of content) lenB += (ch.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
  return 2 * lenB - chars;
}

export async function buildRecordSummary(ctx: ReadCtx, record: Doc<"records">) {
  const student = await ctx.db.get(record.studentId);
  const subject = await ctx.db.get(record.subjectId);
  if (!student || !subject) return null;
  return {
    recordId: record._id,
    studentId: record.studentId,
    subjectId: record.subjectId,
    classNumber: student.classNumber,
    studentNumber: student.studentNumber,
    studentName: student.name,
    subjectLabel: subject.label,
    contentBytes: neatBytes(record.content),
    updatedAt: record.updatedAt,
  };
}

export async function syncRecordSummary(ctx: MutationCtx, record: Doc<"records">) {
  const data = await buildRecordSummary(ctx, record);
  if (!data) return;
  const existing = await ctx.db
    .query("recordSummaries")
    .withIndex("by_record", (q) => q.eq("recordId", record._id))
    .unique();
  if (!existing) {
    await ctx.db.insert("recordSummaries", data);
    return;
  }
  const changed = Object.entries(data).some(([key, value]) => existing[key as keyof typeof existing] !== value);
  if (changed) await ctx.db.patch(existing._id, data);
}

export async function removeRecordSummary(ctx: MutationCtx, recordId: Doc<"records">["_id"]) {
  const existing = await ctx.db
    .query("recordSummaries")
    .withIndex("by_record", (q) => q.eq("recordId", recordId))
    .unique();
  if (existing) await ctx.db.delete(existing._id);
}
