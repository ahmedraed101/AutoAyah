FROM node:22-bookworm-slim

# Shared libraries for Remotion's Chrome Headless Shell (fetched below).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
    libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
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
# Lands in apps/server/node_modules/.remotion, where the server looks for it at runtime.
RUN cd apps/server && node -e "require('@remotion/renderer').ensureBrowser().then(() => console.log('Chrome Headless Shell ready'))"

ENV PORT=3737
ENV DATA_DIR=/app/data
ENV NODE_ENV=production
EXPOSE 3737

VOLUME ["/app/data"]
CMD ["pnpm", "--filter", "@autoayah/server", "start"]
