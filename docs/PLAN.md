# AutoAyah — Plan (implemented)

See the Cursor plan `autoayah_full_product` for the full specification. This repo implements:

- pnpm workspace: `apps/web`, `apps/server`, `packages/{core,data,media,templates,cli}`
- Local-first data resolver (AlQuran.cloud + everyayah + optional Quran Foundation + QUL import)
- SQLite jobs queue (`node:sqlite`, no native addon), SSE progress, batch ZIP export
- Remotion templates for ayah / ayahTafsir / mushafPage / wordHighlight + audio mix
- Stock media search with people filter (COCO-SSD when available)
- PWA editor: dark/light, AR/EN, timeline, projects/renders/downloads/settings
- MCP (`/mcp/call`), OpenAPI, CLI
- Docker + `install.sh` + env-based self_hosted vs hosted

## Run

`./install.sh` or `pnpm install && pnpm build && pnpm start`
