FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-core \
    fonts-noto-extra \
    ca-certificates \
    ffmpeg \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV REMOTION_CHROME_MODE=chrome-for-testing

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile=false
RUN pnpm -r --filter=./packages/* build
RUN pnpm --filter @autoayah/web build
RUN cd /app && npx remotion browser ensure || true

ENV PORT=3737
ENV DATA_DIR=/app/data
ENV NODE_ENV=production
EXPOSE 3737

VOLUME ["/app/data"]
CMD ["pnpm", "--filter", "@autoayah/server", "start"]
