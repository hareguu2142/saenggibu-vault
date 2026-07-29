import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { randomToken, requireSession, sha256 } from "./helpers";

export const login = mutation({
  args: { name: v.string(), code: v.string() },
  handler: async (ctx, { name, code }) => {
    let role: "student" | "teacher" = "student";
    let studentId;
    if (name === "admin" && code === "admin") {
      role = "teacher";
    } else {
      if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]+$/.test(code)) throw new Error("입장 코드는 영문과 숫자를 모두 포함해야 합니다.");
      const candidates = await ctx.db.query("students").withIndex("by_name", (q) => q.eq("name", name)).collect();
      const codeHash = await sha256(code);
      const student = candidates.find((item) => item.codeHash === codeHash);
      if (!student) throw new Error("이름 또는 입장 코드가 올바르지 않습니다.");
      studentId = student._id;
    }
    const token = randomToken();
    await ctx.db.insert("sessions", { token, role, name, studentId, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
    return { token, role, name, studentId };
  },
});

export const me = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => requireSession(ctx, args.sessionToken),
});

export const logout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique();
    if (session) await ctx.db.delete(session._id);
  },
});
