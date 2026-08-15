import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { randomToken, sha256 } from "./helpers";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

type TeacherAccount = { name: string; code: string };

function teacherAccounts(): TeacherAccount[] {
  const raw = process.env.TEACHER_ACCOUNTS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TeacherAccount => {
      if (!item || typeof item !== "object") return false;
      const account = item as Record<string, unknown>;
      return typeof account.name === "string" && typeof account.code === "string" && account.name.trim().length > 0 && account.code.length > 0;
    });
  } catch {
    return [];
  }
}

async function attemptFor(ctx: MutationCtx, key: string) {
  return ctx.db.query("loginAttempts").withIndex("by_key", (q) => q.eq("key", key)).unique();
}

async function registerFailure(ctx: MutationCtx, key: string, now: number) {
  const existing = await attemptFor(ctx, key);
  if (!existing || now - existing.windowStartedAt >= ATTEMPT_WINDOW_MS) {
    if (existing) await ctx.db.patch(existing._id, { attempts: 1, windowStartedAt: now, blockedUntil: undefined });
    else await ctx.db.insert("loginAttempts", { key, attempts: 1, windowStartedAt: now });
    return;
  }
  const attempts = existing.attempts + 1;
  await ctx.db.patch(existing._id, {
    attempts,
    blockedUntil: attempts >= MAX_ATTEMPTS ? now + BLOCK_DURATION_MS : existing.blockedUntil,
  });
}

async function cleanupExpiredSessions(ctx: MutationCtx, now: number) {
  const expired = await ctx.db
    .query("sessions")
    .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
    .take(50);
  for (const session of expired) await ctx.db.delete(session._id);
}

export const login = mutation({
  args: { name: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    const code = args.code.trim();
    const now = Date.now();
    const attemptKey = await sha256(name.toLocaleLowerCase("ko-KR"));
    const existingAttempt = await attemptFor(ctx, attemptKey);
    if (existingAttempt?.blockedUntil && existingAttempt.blockedUntil > now) {
      return { ok: false as const, error: "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요." };
    }

    let role: "student" | "teacher" = "student";
    let studentId;
    const teacher = teacherAccounts().find((account) => account.name === name && account.code === code);
    if (teacher) {
      role = "teacher";
    } else {
      const validCode = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]+$/.test(code);
      const candidates = validCode
        ? await ctx.db.query("students").withIndex("by_name", (q) => q.eq("name", name)).collect()
        : [];
      const codeHash = validCode ? await sha256(code) : "";
      const student = candidates.find((item) => item.codeHash === codeHash);
      if (!student) {
        await registerFailure(ctx, attemptKey, now);
        return { ok: false as const, error: "이름 또는 입장 코드가 올바르지 않습니다." };
      }
      studentId = student._id;
    }

    if (existingAttempt) await ctx.db.delete(existingAttempt._id);
    await cleanupExpiredSessions(ctx, now);
    const token = randomToken();
    const expiresAt = now + 1000 * 60 * 60 * 12;
    await ctx.db.insert("sessions", { token, role, name, studentId, expiresAt });
    return { ok: true as const, token, role, name, studentId, expiresAt };
  },
});

export const me = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique();
    if (!session || session.expiresAt < Date.now() || (session.role === "teacher" && session.name === "admin")) return null;
    return session;
  },
});

export const logout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique();
    if (session) await ctx.db.delete(session._id);
  },
});
