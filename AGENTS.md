# AutoAyah — agent install guide

## What this is

Self-hostable PWA that generates Quran videos (TikTok/YouTube/Instagram ratios) with recitation, optional tafsir, real Mushaf-page mode (15-line Madani layout), word highlighting (exact timings after QUL/QF connect), stock backgrounds with people filtered out, and a render queue.

## Install (preferred)

```bash
git clone <repo-url> AutoAyah
cd AutoAyah
chmod +x install.sh
./install.sh
```

Open http://localhost:3737

## Dev without Docker

Needs Node 22+, pnpm, ffmpeg.

```bash
corepack enable
pnpm install
pnpm --filter @autoayah/core build
pnpm --filter @autoayah/data build
pnpm --filter @autoayah/media build
pnpm --filter @autoayah/templates build
pnpm dev
```

- API: http://localhost:3737
- UI (Vite): http://localhost:5173

## Verify

```bash
curl -s http://localhost:3737/api/health
pnpm doctor
# or
pnpm --filter @autoayah/cli start doctor
```

## Important env

See `.env.example`. `APP_MODE=self_hosted` (default) stores keys/projects in SQLite. `APP_MODE=hosted` stores them in the browser and enables optional limits.

`APP_SECRET` is optional (auto-generated into `data/.secret`). All runtime data — SQLite DB, cache, renders, uploads, generated ambience — lives in `DATA_DIR` (default `./data` at the repo root).

## Agent access

- MCP: `POST /mcp` (JSON-RPC 2.0). REST shim: `GET /mcp/tools`, `POST /mcp/call`.
- OpenAPI: `GET /openapi.json`. Cheat sheet: `llms.txt`.

## Do not

- Never invent Quran text. Always fetch by surah/ayah reference.
- Never commit `.env` or real API keys.
