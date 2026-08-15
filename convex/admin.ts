import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { diffCounts, requireTeacher, sha256 } from "./helpers";
import { removeRecordSummary, syncRecordSummary } from "./recordSummaries";
import type { Id } from "./_generated/dataModel";

async function syncStudentSummaries(ctx: MutationCtx, studentId: Id<"students">) {
  const records = await ctx.db.query("records").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect();
  for (const record of records) await syncRecordSummary(ctx, record);
}

async function syncSubjectSummaries(ctx: MutationCtx, subjectId: Id<"subjects">) {
  const records = await ctx.db.query("records").withIndex("by_subject", (q) => q.eq("subjectId", subjectId)).collect();
  for (const record of records) await syncRecordSummary(ctx, record);
}

export const listStudents = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireTeacher(ctx, sessionToken);
    return (await ctx.db.query("students").collect())
      .map((student) => ({
        _id: student._id,
        _creationTime: student._creationTime,
        classNumber: student.classNumber,
        studentNumber: student.studentNumber,
        name: student.name,
        updatedAt: student.updatedAt,
      }))
      .sort((a, b) => a.classNumber - b.classNumber || a.studentNumber - b.studentNumber);
  },
});

export const upsertStudent = mutation({
  args: { sessionToken: v.string(), studentId: v.optional(v.id("students")), classNumber: v.number(), studentNumber: v.number(), name: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    await requireTeacher(ctx, args.sessionToken);
    const codePattern = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]+$/;
    if (!args.studentId && !codePattern.test(args.code)) throw new Error("코드는 영문과 숫자를 모두 포함해야 합니다.");
    if (args.studentId) {
      const patch: { classNumber: number; studentNumber: number; name: string; updatedAt: number; codeHash?: string } = { classNumber: args.classNumber, studentNumber: args.studentNumber, name: args.name.trim(), updatedAt: Date.now() };
      if (args.code) {
        if (!codePattern.test(args.code)) throw new Error("코드는 영문과 숫자를 모두 포함해야 합니다.");
        patch.codeHash = await sha256(args.code);
      }
      await ctx.db.patch(args.studentId, patch);
      await syncStudentSummaries(ctx, args.studentId);
      return args.studentId;
    }
    return ctx.db.insert("students", { classNumber: args.classNumber, studentNumber: args.studentNumber, name: args.name.trim(), codeHash: await sha256(args.code), updatedAt: Date.now() });
  },
});

export const removeStudent = mutation({
  args: { sessionToken: v.string(), studentId: v.id("students") },
  handler: async (ctx, { sessionToken, studentId }) => {
    await requireTeacher(ctx, sessionToken);
    const records = await ctx.db.query("records").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect();
    for (const record of records) {
      const histories = await ctx.db.query("histories").withIndex("by_record", (q) => q.eq("recordId", record._id)).collect();
      for (const history of histories) await ctx.db.delete(history._id);
      await removeRecordSummary(ctx, record._id);
      await ctx.db.delete(record._id);
    }
    await ctx.db.delete(studentId);
  },
});

export const importStudents = mutation({
  args: { sessionToken: v.string(), students: v.array(v.object({ classNumber: v.number(), studentNumber: v.number(), name: v.string(), code: v.string() })) },
  handler: async (ctx, { sessionToken, students }) => {
    await requireTeacher(ctx, sessionToken);
    for (const item of students) {
      if (!item.name || !/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]+$/.test(item.code)) continue;
      const existing = await ctx.db.query("students").withIndex("by_class_number", (q) => q.eq("classNumber", item.classNumber).eq("studentNumber", item.studentNumber)).unique();
      const data = { classNumber: item.classNumber, studentNumber: item.studentNumber, name: item.name.trim(), codeHash: await sha256(item.code), updatedAt: Date.now() };
      if (existing) {
        await ctx.db.patch(existing._id, data);
        await syncStudentSummaries(ctx, existing._id);
      } else await ctx.db.insert("students", data);
    }
  },
});

export const listSubjects = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireTeacher(ctx, sessionToken);
    const subjects = await ctx.db.query("subjects").collect();
    return Promise.all(subjects.map(async (subject) => ({ ...subject, recordCount: (await ctx.db.query("records").withIndex("by_subject", (q) => q.eq("subjectId", subject._id)).collect()).length })));
  },
});

export const upsertSubject = mutation({
  args: { sessionToken: v.string(), subjectId: v.optional(v.id("subjects")), label: v.string() },
  handler: async (ctx, { sessionToken, subjectId, label }) => {
    await requireTeacher(ctx, sessionToken);
    const clean = label.trim();
    if (!clean) throw new Error("과목명을 입력해 주세요.");
    if (subjectId) {
      await ctx.db.patch(subjectId, { label: clean });
      await syncSubjectSummaries(ctx, subjectId);
      return subjectId;
    }
    return ctx.db.insert("subjects", { label: clean, createdAt: Date.now() });
  },
});

export const removeSubject = mutation({
  args: { sessionToken: v.string(), subjectId: v.id("subjects") },
  handler: async (ctx, { sessionToken, subjectId }) => {
    await requireTeacher(ctx, sessionToken);
    const record = await ctx.db.query("records").withIndex("by_subject", (q) => q.eq("subjectId", subjectId)).first();
    if (record) throw new Error("생활기록부가 있는 과목은 삭제할 수 없습니다.");
    await ctx.db.delete(subjectId);
  },
});

export const importRecords = mutation({
  args: { sessionToken: v.string(), subjectId: v.id("subjects"), records: v.array(v.object({ classNumber: v.number(), studentNumber: v.number(), name: v.string(), content: v.string() })) },
  handler: async (ctx, { sessionToken, subjectId, records }) => {
    const teacher = await requireTeacher(ctx, sessionToken);
    for (const item of records) {
      const student = await ctx.db.query("students").withIndex("by_class_number", (q) => q.eq("classNumber", item.classNumber).eq("studentNumber", item.studentNumber)).unique();
      if (!student || student.name !== item.name.trim()) continue;
      const existing = await ctx.db.query("records").withIndex("by_student_subject", (q) => q.eq("studentId", student._id).eq("subjectId", subjectId)).unique();
      if (existing) {
        if (existing.content !== item.content) {
          const updatedAt = Date.now();
          await ctx.db.insert("histories", { recordId: existing._id, beforeContent: existing.content, afterContent: item.content, ...diffCounts(existing.content, item.content), actorName: `${teacher.name} (엑셀)`, createdAt: updatedAt });
          await ctx.db.patch(existing._id, { content: item.content, updatedAt });
          await syncRecordSummary(ctx, { ...existing, content: item.content, updatedAt });
        }
      } else {
        const recordId = await ctx.db.insert("records", { studentId: student._id, subjectId, content: item.content, updatedAt: Date.now() });
        const record = await ctx.db.get(recordId);
        if (record) await syncRecordSummary(ctx, record);
      }
    }
  },
});

export const exportRecords = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireTeacher(ctx, sessionToken);
    const records = await ctx.db.query("records").collect();
    return Promise.all(records.map(async (record) => {
      const student = await ctx.db.get(record.studentId);
      const subject = await ctx.db.get(record.subjectId);
      return { ...record, classNumber: student?.classNumber ?? 0, studentNumber: student?.studentNumber ?? 0, studentName: student?.name ?? "", subjectLabel: subject?.label ?? "" };
    }));
  },
});
