import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encrypt(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(secret: string, payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const hmac = (key: string, body: string) => createHmac("sha256", key).update(body).digest("base64url");

/** Signed session token `<expiry>.<sig>`; `key` should change when the password changes. */
export function signSession(key: string, ttlMs: number): string {
  const body = String(Date.now() + ttlMs);
  return `${body}.${hmac(key, body)}`;
}

export function verifySession(key: string, token: string): boolean {
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  if (!safeEqual(sig, hmac(key, body))) return false;
  return Number(body) > Date.now();
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
