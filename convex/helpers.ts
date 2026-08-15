import type { MutationCtx, QueryCtx } from "./_generated/server";

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function requireSession(ctx: QueryCtx | MutationCtx, token: string) {
  const session = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!session || session.expiresAt < Date.now()) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
  return session;
}

export async function requireTeacher(ctx: QueryCtx | MutationCtx, token: string) {
  const session = await requireSession(ctx, token);
  if (session.role !== "teacher") throw new Error("교사 권한이 필요합니다.");
  return session;
}

export function diffCounts(before: string, after: string) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return {
    removedCount: Array.from(before.slice(prefix, before.length - suffix)).length,
    addedCount: Array.from(after.slice(prefix, after.length - suffix)).length,
  };
}
