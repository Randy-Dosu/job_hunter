import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Every API handler resolves the caller from the session cookie — never from the body. */
export async function withUser<T>(handler: (user: SessionUser) => Promise<T> | T) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in to continue.", 401);
  return handler(user);
}

export function parseBody<T>(value: unknown): T {
  return value as T;
}
