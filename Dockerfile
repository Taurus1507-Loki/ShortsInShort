# syntax=docker/dockerfile:1.7
# ShortsInShort production image: one image, two roles.
#   API + web app:  docker run … image                     (node dist/server.js, port 5000)
#   Worker:         docker run … image node dist/worker.js (renders; scale by running more)
# Build: docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t shortsinshort .

# Node 24 LTS (npm 11) — the lockfiles are written by npm 11, which npm 10 rejects.
ARG NODE_IMAGE=node:24-bookworm-slim

# ── Dependencies (cached until a lockfile changes) ──
FROM ${NODE_IMAGE} AS deps
# Tests aren't run in the image: skip mongodb-memory-server's ~100 MB mongod download.
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY server/package.json server/package-lock.json server/
COPY client/package.json client/package-lock.json client/
RUN npm --prefix server ci --no-audit --no-fund && npm --prefix client ci --no-audit --no-fund

# ── Build: server (tsc), web app (vite), Motion Explainer bundle (Remotion) ──
FROM deps AS build
COPY server server
COPY client client
RUN npm --prefix server run build && npm --prefix client run build
# prepareMotion imports the server config, which validates env: give it throwaway build-only values.
RUN cd server && MONGODB_URI=mongodb://build.invalid/build JWT_ACCESS_SECRET=build-only-placeholder-never-used-at-runtime \
    npx tsx src/scripts/prepareMotion.ts /app/motion-bundle --no-browser
RUN npm --prefix server prune --omit=dev --no-audit --no-fund

# ── Runtime ──
FROM ${NODE_IMAGE} AS runtime
# tini: proper signal handling (graceful shutdown). Fonts: Inter + Noto (Latin, Devanagari, Telugu,
# Tamil) for burned-in captions and Motion Explainer. The rest: libraries Remotion's headless Chrome needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates fonts-inter fonts-noto-core \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
      libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/storage && chown node:node /data/storage

ENV NODE_ENV=production \
    PORT=5000 \
    CLIENT_DIST_DIR=/app/client/dist \
    MOTION_BUNDLE_DIR=/app/motion-bundle \
    CAPTION_FONTS_DIR=/usr/share/fonts \
    STORAGE_LOCAL_DIR=/data/storage

WORKDIR /app/server
COPY --from=build --chown=node:node /app/server/package.json ./
COPY --from=build --chown=node:node /app/server/node_modules node_modules
COPY --from=build /app/server/dist dist
COPY --from=build /app/client/dist /app/client/dist
COPY --from=build /app/motion-bundle /app/motion-bundle

USER node
# Download Remotion's headless Chrome into the image (not on the first render).
RUN node -e "require('@remotion/renderer').ensureBrowser().then(() => console.log('Headless Chrome ready'))"

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
EXPOSE 5000
VOLUME ["/data/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
