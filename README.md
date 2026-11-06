# AutoAyah

PWA video editor for Quran content creators. Pick ayat, a reciter, optional tafsir/translation, aspect ratio, background and audio mix — preview, queue a render, download MP4/WebM/PNG/SRT/batch ZIP.

## Quick start

```bash
cp .env.example .env
./install.sh
# → http://localhost:3737
```

### Dev

```bash
pnpm install
pnpm --filter @autoayah/core build && pnpm --filter @autoayah/data build && pnpm --filter @autoayah/media build && pnpm --filter @autoayah/templates build
pnpm dev
```

- UI: http://localhost:5173  
- API: http://localhost:3737  

## Features

- Modes: ayah, ayah + tafsir, Mushaf page (the scanned printed Madani page, with the current ayah highlighted on the scan), word highlight (exact timings with QF, estimated otherwise)
- Aspects: 9:16, 16:9, 1:1, 4:5
- Timing: continuous or reading pause (fast/slow/very slow) + per-ayah overrides
- Mushaf-style design: ornamental surah banner, tajweed-colored Uthmani text, ayah medallion, tafsir card (light by default, dark theme available)
- Stock images/videos (Pexels/Unsplash/Pixabay) with people filtered out: tag/keyword blocklist plus an on-device person detector (TensorFlow.js, WASM backend — no native addon)
- Audio mix: recitation (cached locally), generated ambience loops (rain, wind, ocean, forest), optional background-video sound (off by default)
- Local-first data cache; Downloads page in self-hosted mode
- SQLite render queue with SSE progress
- MCP (`POST /mcp`), OpenAPI (`/openapi.json`) and the `autoayah` CLI for AI agents
- Dark default UI, Arabic/English RTL

## Config

See [`.env.example`](.env.example). `APP_MODE=self_hosted` stores keys/projects in the DB; `hosted` stores them in the browser and can enable rate limits.

`APP_SECRET` is optional: when unset, a random one is generated on first start and kept in `data/.secret`. Set `APP_PASSWORD` to require a login.

## Docs

- [docs/PLAN.md](docs/PLAN.md) — full product plan  
- [AGENTS.md](AGENTS.md) — install instructions for AI tools  
- [llms.txt](llms.txt) — API cheat sheet  

## License

MIT for code. Quran text/tafsir/audio keep their original licenses — show attribution.
