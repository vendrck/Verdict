import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appEnv } from "@/config/env";

export const ADMIN_COOKIE = "pp_admin";
const SESSION_HOURS = 8;

/**
 * The cookie holds an HMAC keyed with the admin password, plus its expiry.
 * Changing ADMIN_PASSWORD invalidates every session; nothing is stored server-side.
 */
export function signSession(password: string, expiresAt: number): string {
  const mac = createHmac("sha256", password).update(`proofpay-admin:${expiresAt}`).digest("base64url");
  return `${expiresAt}.${mac}`;
}

export function verifySession(password: string | undefined, token: string | undefined, now = Date.now()): boolean {
  if (!password || !token) return false;
  const [exp, mac] = token.split(".");
  const expiresAt = Number(exp);
  if (!mac || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = Buffer.from(signSession(password, expiresAt));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function passwordMatches(password: string | undefined, attempt: string): boolean {
  if (!password) return false;
  // Compare digests so the comparison is constant-time regardless of length.
  const a = createHmac("sha256", "pp").update(password).digest();
  const b = createHmac("sha256", "pp").update(attempt).digest();
  return timingSafeEqual(a, b);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(appEnv().ADMIN_PASSWORD, jar.get(ADMIN_COOKIE)?.value);
}

/** Call at the top of every admin page AND every admin server action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function startAdminSession(): Promise<void> {
  const password = appEnv().ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is not set");
  const expiresAt = Date.now() + SESSION_HOURS * 3600_000;
  (await cookies()).set(ADMIN_COOKIE, signSession(password, expiresAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}
