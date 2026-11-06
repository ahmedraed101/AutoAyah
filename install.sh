#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "==> AutoAyah installer"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop / Engine, then re-run."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

mkdir -p data/out data/cache data/uploads

echo "==> Building and starting"
docker compose up --build -d

echo "==> Waiting for health"
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${PORT:-3737}/api/health" >/dev/null; then
    echo "AutoAyah is ready at http://localhost:${PORT:-3737}"
    exit 0
  fi
  sleep 2
done

echo "Timed out waiting for /api/health. Check: docker compose logs -f"
exit 1
