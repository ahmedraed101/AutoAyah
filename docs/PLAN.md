# AutoAyah — Plan

Generate short vertical videos (TikTok / Reels / Shorts) of Quran ayat with recitation and optional tafsir,
like the "Wahy" style: surah header, Uthmani ayah text, tafsir card, attribution.

## Goals

- Select one ayah or a range, a reciter, and optionally a tafsir; preview; generate MP4; download/share.
- Usable by people (PWA) and by AI agents (REST + OpenAPI, MCP server, CLI).
- Trivial self-hosting: `docker compose up`, or give the repo link to an AI tool and it installs it (`AGENTS.md`, `install.sh`).
- Self-hosted = unlimited by default. Every limit is an env var, used only by the public hosted version.
- License: MIT for code. Each data resource keeps its own license/attribution (shown in Library and in videos).

## Product

Flow: pick surah + ayah range → reciter → tafsir on/off + which tafsir → style/template → live preview → render → progress → view → download/share.

Layout modes (same data, different templates):
1. One ayah per slide (MVP).
2. Mushaf page view with current ayah highlighted (needs QUL Mushaf layouts).
3. Word-by-word highlight synced to recitation (needs word timings; only some reciters have them).

Ayah + tafsir are shown together. Slide duration = max(audio duration, tafsir reading time ≈ 180–200 Arabic wpm).
Extra time is padded with silence. Tafsir that does not fit is paginated inside the slide; long ayat are split at waqf marks / word timings.

Quran text is only ever taken from verified sources by reference — never typed or AI-generated.

## Data sources

| Source | Use | Notes |
|---|---|---|
| [QUL](https://qul.tarteel.ai/resources) | Main source: Uthmani/tajweed text, words, fonts, surah-name font, 20 Mushaf layouts, 115 tafsirs (incl. Arabic Al-Mukhtasar), 198 translations, 131 recitations (58 with timestamps) | Download requires sign-in; no API. Meant to be packaged with your project. |
| [everyayah.com](https://everyayah.com) | Per-ayah MP3: `https://everyayah.com/data/{Reciter}/{SSSAAA}.mp3` | Public, no key. Used by MVP. |
| [AlQuran.cloud](https://alquran.cloud/api) | `quran-uthmani` text, Arabic tafsirs (`ar.muyassar`, `ar.jalalayn`, `ar.qurtubi`, `ar.baghawi`, `ar.waseet`, `ar.miqbas`) | Public, no key. Used by MVP. |
| [Quran Foundation API](https://api-docs.quran.foundation) | Fill gaps (word timings, tafsirs) | Needs client credentials. |
| [Tanzil](https://tanzil.net/download) | Cross-check text correctness | |

## Data packs and the Library (post-MVP)

Because QUL needs a login, the maintainer downloads QUL resources once, `tools/build-packs` converts them into
one small file per resource, and a GitHub Action publishes them as GitHub Release assets with a `catalog.json`
(id, type, language, size, version, checksum, license, attribution).

- Fresh install = core only (text, words, fonts, metadata, one default tafsir + reciter).
- Library page in the PWA: browse/filter all resources, install/update/remove, show disk usage and budget.
- Audio: lazy fetch + cache with LRU eviction; optional "download full reciter" (pinned, not evicted).
- Same controls via MCP (`list_resources`, `install_resource`, `remove_resource`) and CLI (`autoayah library ...`).
- Contact the QUL team about redistribution.

## Architecture (target)

One Docker image, same for self-hosted and hosted; behaviour differs only by env.

- `apps/pwa` — Vite + React PWA (editor, Library, Remotion Player preview).
- `apps/server` — Hono API + MCP server + SQLite job table + env limits.
- `packages/core` — data access, slide timing/pagination, video-config validation (no rendering code).
- `packages/templates` — renderer-agnostic React templates taking `{ slide, timeMs, theme }`.
- `packages/render-remotion` — thin Remotion adapter (swappable for Playwright + FFmpeg later).
- `packages/cli` — `autoayah render | library | doctor`.
- `tools/build-packs` — QUL → packs + catalog.
- Root: `AGENTS.md`, `llms.txt`, `install.sh`, `docker-compose.yml` (optional Caddy for LAN HTTPS), `.env.example`.

Audio is assembled with FFmpeg (concat ayah MP3s + silence padding), independent of the renderer.
Identical render configs are cached by hash.

### API (target)

`GET /surahs`, `GET /ayat?surah&from&to`, `GET /reciters`, `GET /tafsirs`, `GET /tafsir/:id?surah&from&to`,
`POST /renders` (returns job id or cached video), `GET /renders/:id`, `/openapi.json`, `/health`.

MCP tools: `find_ayat` (reference, keyword, topic), `list_reciters`, `list_tafsirs`, `list_templates`,
`preview_video` (dry run: slides, duration, warnings), `render_video`, `get_render_status`, library tools.
Errors must be actionable (e.g. "Al-Furqan has 77 ayat").

### Env

| Variable | Default | Purpose |
|---|---|---|
| `RENDER_LIMIT_PER_DAY` | unset (unlimited) | Renders per IP / API key per day |
| `MAX_VIDEO_SECONDS` | unset | Max video length |
| `MAX_AYAT_PER_VIDEO` | unset | Max ayah range |
| `MAX_CONCURRENT_RENDERS` | CPU count | Protect the machine |
| `VIDEO_RETENTION_HOURS` | unset | Auto-delete old videos |
| `API_KEYS` | unset (open) | Require a key |
| `STORAGE` | `local` | `local` or `s3` (+ S3/R2 vars) |
| `PUBLIC_URL` | `http://localhost:PORT` | Download link base |
| `DATA_DIR` | `./data` | Resources + cache |
| `AUDIO_CACHE_MAX_GB` | unset | Audio cache cap |
| `LIBRARY_MAX_GB` | unset | Installed resources cap |
| `LIBRARY_ADMIN_TOKEN` | unset | Restrict Library changes (hosted) |
| `CATALOG_URL` | GitHub release | Custom mirror |
| `PRELOAD_RESOURCES` | unset | Resource ids to install at startup |

## Notes / risks

- PWA install needs HTTPS (works on `localhost`; on LAN use Caddy local CA or Tailscale).
- Remotion license: free for individuals and companies ≤ 3 people. Keep templates portable to swap renderer.
- Licensing of tafsirs (Markaz Tafsir for Al-Mukhtasar, KFGQPC for Al-Muyassar) and reciter audio; show attribution.
- No background music by default.
- Arabic shaping: render in Chromium with proper Quran fonts, never FFmpeg drawtext.

## Roadmap

0. **MVP (now)** — see below.
1. Data packs + catalog + build script.
2. Core + server: timing package, read endpoints, Library, env limits.
3. Screenshot-style template, Remotion adapter, FFmpeg audio, render jobs.
4. PWA: editor, preview, Library, share.
5. AI + self-hosting: MCP, CLI, `AGENTS.md`, `install.sh`, Docker, Caddy.
6. Mushaf page + word highlight layouts, more templates, hosted deployment with limits.

## MVP scope (very light)

- Single Node/TypeScript package, one Dockerfile. No queue, no DB, no monorepo, no CSS beyond what the video needs.
- Data: AlQuran.cloud (`quran-uthmani` + Arabic tafsir editions), everyayah.com for audio (hardcoded reciter list).
- Backend: a few endpoints; render with `@remotion/renderer` in-process; progress kept in memory; output to `./out`.
- Frontend: plain HTML-ish React page — select surah/range/reciter/tafsir, Remotion Player preview,
  Generate → progress → video element → download link.
- One template, 1080×1920, one ayah per slide.
