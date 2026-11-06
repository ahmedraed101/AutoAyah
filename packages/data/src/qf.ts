import type { QfCredentials } from "./types.js";

type QfEnv = "prelive" | "production";
type TokenCache = { token: string; expiresAt: number };

const tokens = new Map<string, TokenCache>();
/** Environment a client id actually belongs to, learned on first successful token request. */
const detectedEnv = new Map<string, QfEnv>();
const TIMEOUT_MS = 15_000;

function hosts(env: QfEnv) {
  if (env === "production") {
    return {
      oauth: "https://oauth2.quran.foundation",
      api: "https://apis.quran.foundation",
    };
  }
  return {
    oauth: "https://prelive-oauth2.quran.foundation",
    api: "https://apis-prelive.quran.foundation",
  };
}

class QfAuthError extends Error {}

async function requestToken(creds: QfCredentials, env: QfEnv): Promise<TokenCache> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`${hosts(env).oauth}/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=content",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`Could not reach Quran Foundation (${env}): ${(e as Error).message}`);
  }
  if (res.status === 400 || res.status === 401) throw new QfAuthError(await res.text());
  if (!res.ok) throw new Error(`Quran Foundation token request failed (${env}): HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

/** Get a token, falling back to the other environment when keys were issued for it (e.g. production keys with QF_ENV=prelive). */
async function getToken(creds: QfCredentials): Promise<{ token: string; env: QfEnv }> {
  const preferred: QfEnv = detectedEnv.get(creds.clientId) ?? creds.env ?? "prelive";
  const cached = tokens.get(`${preferred}:${creds.clientId}`);
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.token, env: preferred };

  const order: QfEnv[] = preferred === "prelive" ? ["prelive", "production"] : ["production", "prelive"];
  for (const env of order) {
    try {
      const t = await requestToken(creds, env);
      tokens.set(`${env}:${creds.clientId}`, t);
      detectedEnv.set(creds.clientId, env);
      return { token: t.token, env };
    } catch (e) {
      if (!(e instanceof QfAuthError)) throw e;
    }
  }
  throw new Error("Quran Foundation rejected these credentials (invalid client id or secret) on both prelive and production.");
}

export async function qfFetch<T>(creds: QfCredentials, path: string, retry = true): Promise<T> {
  const { token, env } = await getToken(creds);
  const res = await fetch(`${hosts(env).api}${path}`, {
    headers: { "x-auth-token": token, "x-client-id": creds.clientId },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 && retry) {
    tokens.delete(`${env}:${creds.clientId}`);
    return qfFetch(creds, path, false);
  }
  if (res.status === 403) throw new Error(`Quran Foundation denied access to ${path} (HTTP 403) — these keys may not include this API.`);
  if (!res.ok) throw new Error(`Quran Foundation ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function testQfConnection(creds: QfCredentials): Promise<{ ok: boolean; message: string; env?: QfEnv }> {
  try {
    await qfFetch(creds, "/content/api/v4/chapters");
    const env = detectedEnv.get(creds.clientId) ?? creds.env ?? "prelive";
    const note = env === "prelive" ? " Prelive keys only cover Al-Fatiha and Al-Baqarah." : "";
    return { ok: true, env, message: `Connected to Quran Foundation (${env}).${note}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export type QfVerse = {
  verse_key: string;
  text_uthmani: string;
  page_number?: number;
  words?: { text: string; position: number }[];
};

export async function fetchQfVerses(
  creds: QfCredentials,
  chapter: number,
  from: number,
  to: number,
): Promise<QfVerse[]> {
  const data = await qfFetch<{ verses: QfVerse[] }>(
    creds,
    `/content/api/v4/verses/by_chapter/${chapter}?words=true&fields=text_uthmani,page_number&from=${from}&to=${to}&per_page=50`,
  );
  return data.verses ?? [];
}

export type QfWordSegment = [number, number, number]; // word_index, start_ms, end_ms

export async function fetchQfChapterAudio(
  creds: QfCredentials,
  chapter: number,
  recitationId: number,
): Promise<{
  audioUrl: string;
  timestamps: { verse_key: string; timestamp_from: number; timestamp_to: number; segments?: QfWordSegment[] }[];
} | null> {
  try {
    const data = await qfFetch<{
      audio_file: {
        audio_url: string;
        timestamps: { verse_key: string; timestamp_from: number; timestamp_to: number; segments?: QfWordSegment[] }[];
      };
    }>(creds, `/content/api/v4/chapter_recitations/${recitationId}/${chapter}?segments=true`);
    return {
      audioUrl: data.audio_file.audio_url,
      timestamps: data.audio_file.timestamps ?? [],
    };
  } catch {
    return null;
  }
}
