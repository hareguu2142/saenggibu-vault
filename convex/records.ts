import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { diffCounts, requireSession, requireTeacher } from "./helpers";

const EMPTY_CONTENT_MESSAGE = "아직 작성된 내용이 없습니다.";

async function authorizedRecord(ctx: any, session: any, recordId: any) {
  const record = await ctx.db.get(recordId);
  if (!record) throw new Error("기록을 찾을 수 없습니다.");
  if (session.role === "student" && record.studentId !== session.studentId) throw new Error("이 기록을 볼 권한이 없습니다.");
  return record as any;
}

export const list = query({
  args: {
    sessionToken: v.string(),
    filters: v.object({ className: v.string(), number: v.string(), name: v.string(), subject: v.string(), content: v.string() }),
  },
  handler: async (ctx, { sessionToken, filters }) => {
    const session = await requireSession(ctx, sessionToken);
    const students = session.role === "teacher"
      ? await ctx.db.query("students").collect()
      : [await ctx.db.get(session.studentId!)].filter((student) => student !== null);
    const records = session.role === "teacher"
      ? await ctx.db.query("records").collect()
      : await ctx.db.query("records").withIndex("by_student", (q) => q.eq("studentId", session.studentId!)).collect();
    const enriched = await Promise.all(records.map(async (record) => {
      const student = await ctx.db.get(record.studentId);
      const subject = await ctx.db.get(record.subjectId);
      return student && subject ? { ...record, classNumber: student.classNumber, studentNumber: student.studentNumber, studentName: student.name, subjectLabel: subject.label, hasRecord: true } : null;
    }));
    const validRecords = enriched.filter((record): record is NonNullable<typeof record> => !!record);
    const studentIdsWithRecords = new Set(validRecords.map((record) => record.studentId));
    const studentsWithoutRecords = students
      .filter((student) => !studentIdsWithRecords.has(student!._id))
      .map((student) => ({
        _id: `student-without-record:${student!._id}`,
        studentId: student!._id,
        content: "",
        updatedAt: student!.updatedAt,
        classNumber: student!.classNumber,
        studentNumber: student!.studentNumber,
        studentName: student!.name,
        subjectLabel: "",
        hasRecord: false,
      }));

    return [...validRecords, ...studentsWithoutRecords]
      .filter((r) =>
        (!filters.className || String(r.classNumber).includes(filters.className)) &&
        (!filters.number || String(r.studentNumber).includes(filters.number)) &&
        (!filters.name || r.studentName.toLowerCase().includes(filters.name.toLowerCase())) &&
        (!filters.subject || r.subjectLabel.toLowerCase().includes(filters.subject.toLowerCase())) &&
        (!filters.content || (r.content || EMPTY_CONTENT_MESSAGE).toLowerCase().includes(filters.content.toLowerCase()))
      ).sort((a, b) => a.classNumber - b.classNumber || a.studentNumber - b.studentNumber || a.subjectLabel.localeCompare(b.subjectLabel, "ko"));
  },
});

export const get = query({
  args: { sessionToken: v.string(), recordId: v.id("records") },
  handler: async (ctx, { sessionToken, recordId }) => {
    const session = await requireSession(ctx, sessionToken);
    const record: any = await authorizedRecord(ctx, session, recordId);
    const student: any = await ctx.db.get(record.studentId);
    const subject: any = await ctx.db.get(record.subjectId);
    const histories = await ctx.db.query("histories").withIndex("by_record", (q) => q.eq("recordId", recordId)).collect();
    return { ...record, studentName: student?.name ?? "", classNumber: student?.classNumber ?? 0, studentNumber: student?.studentNumber ?? 0, subjectLabel: subject?.label ?? "", histories: histories.sort((a, b) => b.createdAt - a.createdAt) };
  },
});

export const update = mutation({
  args: { sessionToken: v.string(), recordId: v.id("records"), content: v.string() },
  handler: async (ctx, { sessionToken, recordId, content }) => {
    const session = await requireTeacher(ctx, sessionToken);
    const record: any = await authorizedRecord(ctx, session, recordId);
    if (record.content === content) return;
    await ctx.db.insert("histories", { recordId, beforeContent: record.content, afterContent: content, ...diffCounts(record.content, content), actorName: session.name, createdAt: Date.now() });
    await ctx.db.patch(recordId, { content, updatedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { sessionToken: v.string(), historyId: v.id("histories") },
  handler: async (ctx, { sessionToken, historyId }) => {
    const session = await requireTeacher(ctx, sessionToken);
    const history = await ctx.db.get(historyId);
    if (!history) throw new Error("수정 이력을 찾을 수 없습니다.");
    const record: any = await authorizedRecord(ctx, session, history.recordId);
    const content = history.afterContent;
    if (record.content === content) return;
    await ctx.db.insert("histories", { recordId: record._id, beforeContent: record.content, afterContent: content, ...diffCounts(record.content, content), actorName: `${session.name} (되돌리기)`, createdAt: Date.now() });
    await ctx.db.patch(record._id, { content, updatedAt: Date.now() });
  },
});
