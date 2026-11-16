import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminEmails, all, get, insert, nowIso, parseJson, run, uid } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

export const SESSION_COOKIE = "jh_session";
const SESSION_DAYS = 14;

export type SessionUser = { id: string; email: string; name: string; role: string };

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = get<{ id: string; email: string; name: string; role: string }>(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    token,
    nowIso(),
  );
  return row ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function createSession(userId: string) {
  const token = uid();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  insert("sessions", { id: token, user_id: userId, expires_at: expires, created_at: nowIso() });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expires),
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE id = ?", token);
  store.delete(SESSION_COOKIE);
}

export type AuthResult = { ok: true; userId: string } | { ok: false; error: string };

export function registerUser(input: { name: string; email: string; password: string }): AuthResult {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (input.password.length < 8) return { ok: false, error: "Use at least 8 characters for your password." };
  if (get("SELECT id FROM users WHERE email = ?", email)) return { ok: false, error: "That email is already registered." };

  const userId = uid();
  const createdAt = nowIso();
  insert("users", {
    id: userId,
    email,
    name: input.name.trim() || email.split("@")[0],
    password_hash: hashPassword(input.password),
    role: adminEmails().includes(email) ? "admin" : "user",
    created_at: createdAt,
  });
  insert("candidate_profiles", {
    id: uid(),
    user_id: userId,
    headline: "",
    summary: "",
    location: "",
    phone: "",
    links_json: "[]",
    work_authorization: "",
    needs_sponsorship: 0,
    timezone: "UTC",
    created_at: createdAt,
    updated_at: createdAt,
  });
  insert("job_preferences", {
    id: uid(),
    user_id: userId,
    countries_json: "[]",
    cities_json: "[]",
    remote_preference: "remote",
    remote_regions_json: "[]",
    role_titles_json: "[]",
    role_families_json: "[]",
    seniority_json: "[]",
    job_types_json: "[]",
    industries_json: "[]",
    excluded_employers_json: "[]",
    excluded_keywords_json: "[]",
    excluded_locations_json: "[]",
    salary_floor: null,
    currency: "USD",
    language: "en",
    work_authorization: "",
    needs_sponsorship: 0,
    days_of_week_json: "[1,2,3,4,5]",
    search_time: "07:00",
    timezone: "UTC",
    notify_email: 1,
    notify_in_app: 1,
    schedule_enabled: 1,
    enabled_source_ids_json: "[]",
    updated_at: createdAt,
  });
  // New accounts enable every reviewed source by default.
  const sources = all<{ id: string }>("SELECT id FROM job_sources WHERE enabled = 1");
  run("UPDATE job_preferences SET enabled_source_ids_json = ? WHERE user_id = ?", JSON.stringify(sources.map((s) => s.id)), userId);
  insert("audit_events", {
    id: uid(),
    user_id: userId,
    actor: "user",
    action: "account.created",
    entity_type: "user",
    entity_id: userId,
    metadata_json: "{}",
    created_at: createdAt,
  });
  return { ok: true, userId };
}

export function loginUser(input: { email: string; password: string }): AuthResult {
  const email = input.email.trim().toLowerCase();
  const user = get<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = ?",
    email,
  );
  if (!user || !verifyPassword(input.password, user.password_hash)) {
    return { ok: false, error: "Email or password is incorrect." };
  }
  return { ok: true, userId: user.id };
}

export { audit } from "@/lib/audit";

export function userOwns(userId: string, table: string, id: string): boolean {
  return Boolean(get(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, id, userId));
}

export { parseJson };
