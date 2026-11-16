import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** 429 with a retry hint, used by the auth rate limiter. */
export function tooMany(retryAfterMs: number, message = "Too many attempts. Wait a minute and try again.") {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: message, retryAfterSeconds: seconds },
    { status: 429, headers: { "retry-after": String(seconds) } },
  );
}

/** Every API handler resolves the caller from the session cookie — never from the body. */
export async function withUser<T>(handler: (user: SessionUser) => Promise<T> | T) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in to continue.", 401);
  return handler(user);
}

/** Source governance and quality review are administrator-only. */
export async function withAdmin<T>(handler: (user: SessionUser) => Promise<T> | T) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in to continue.", 401);
  if (user.role !== "admin") return fail("Administrator access required.", 403);
  return handler(user);
}

export function parseBody<T>(value: unknown): T {
  return value as T;
}
