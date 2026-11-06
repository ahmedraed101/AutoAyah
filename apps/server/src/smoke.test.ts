/**
 * Lightweight API smoke — run with server already up:
 *   AUTOAYAH_URL=http://localhost:3737 npx tsx src/smoke.test.ts
 */
const base = process.env.AUTOAYAH_URL ?? "http://localhost:3737";

async function main() {
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  if (!(health as { ok?: boolean }).ok) throw new Error("health failed");

  const preview = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      surah: 1,
      from: 1,
      to: 1,
      reciter: "Alafasy_128kbps",
      mode: "ayah",
    }),
  }).then((r) => r.json());
  if (!(preview as { timeline?: { totalFrames: number } }).timeline?.totalFrames) {
    throw new Error("preview missing timeline");
  }

  const openapi = await fetch(`${base}/openapi.json`).then((r) => r.json());
  if (!(openapi as { openapi?: string }).openapi) throw new Error("openapi missing");

  const mcp = await fetch(`${base}/mcp/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "find_ayat", arguments: { reference: "25:7-10" } }),
  }).then((r) => r.json());
  if (!(mcp as { ok?: boolean }).ok) throw new Error("mcp find_ayat failed");

  console.log("smoke ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
