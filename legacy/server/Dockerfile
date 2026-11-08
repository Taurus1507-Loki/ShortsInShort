# Multi-stage production Dockerfile for ShortsInShort Backend API & FFmpeg Worker
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy TypeScript source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript
RUN npm run build

# Production Runner Stage
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install system dependencies: FFmpeg, FFprobe, and fonts for ASS subtitle rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-liberation \
    fontconfig \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set production environment
ENV NODE_ENV=production
ENV PORT=5000

# Copy compiled assets & production node_modules
COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Create uploads directory structure
RUN mkdir -p uploads/raw uploads/processed uploads/thumbnails uploads/broll uploads/avatars uploads/music uploads/sfx uploads/temp

# Non-root user for container security
USER node

EXPOSE 5000

CMD ["node", "dist/server.js"]

