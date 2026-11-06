import type { NextFunction, Request, Response } from "express";
import { safeEqual, signSession, verifySession } from "./crypto.js";
import type { Env } from "./env.js";

const COOKIE = "autoayah_session";
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

const failures = new Map<string, { count: number; since: number }>();

/** Session key is bound to the password, so changing APP_PASSWORD logs everyone out. */
const sessionKey = (env: Env) => `${env.APP_SECRET}:${env.APP_PASSWORD ?? ""}`;

function tokenFrom(req: Request): string | undefined {
  const header = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return (req.cookies?.[COOKIE] as string | undefined) ?? (req.headers["x-autoayah-token"] as string | undefined) ?? header;
}

export function isAuthenticated(env: Env, req: Request): boolean {
  if (!env.APP_PASSWORD) return true;
  const token = tokenFrom(req);
  return Boolean(token && verifySession(sessionKey(env), token));
}

export function authMiddleware(env: Env) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.APP_PASSWORD) return next();
    if (req.path === "/api/auth/login" || req.path === "/api/auth/status" || req.path === "/api/health") {
      return next();
    }
    if (!req.path.startsWith("/api/") && !req.path.startsWith("/mcp")) return next();
    if (isAuthenticated(env, req)) return next();
    res.status(401).json({ error: "Authentication required" });
  };
}

export function loginHandler(env: Env) {
  return (req: Request, res: Response) => {
    if (!env.APP_PASSWORD) return res.json({ ok: true });
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const f = failures.get(ip);
    if (f && now - f.since < FAILURE_WINDOW_MS && f.count >= MAX_FAILURES) {
      return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    }
    const password = String(req.body?.password ?? "");
    if (!safeEqual(password, env.APP_PASSWORD)) {
      const fresh = !f || now - f.since >= FAILURE_WINDOW_MS;
      failures.set(ip, { count: fresh ? 1 : f.count + 1, since: fresh ? now : f.since });
      return res.status(401).json({ error: "Invalid password" });
    }
    failures.delete(ip);
    const token = signSession(sessionKey(env), SESSION_TTL_MS);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.PUBLIC_URL.startsWith("https://"),
      maxAge: SESSION_TTL_MS,
    });
    res.json({ ok: true, token });
  };
}

export function authStatus(env: Env) {
  return (req: Request, res: Response) => {
    if (!env.APP_PASSWORD) return res.json({ required: false, authenticated: true });
    res.json({ required: true, authenticated: isAuthenticated(env, req) });
  };
}
