# syntax=docker/dockerfile:1.7
# ==============================================================================
# BROKR — Phase 4 Stage A Multi-Stage Production Container (Cloud Run Ready)
# ==============================================================================
# Security & Budget Principles:
# - Multi-stage build keeps TypeScript/build tooling out of the runtime layer
# - Uses pinned Debian Chromium for Puppeteer instead of downloading at runtime
# - Runs strictly as an unprivileged non-root user (UID 1001)
# - Zero secrets or .env files baked into the container image

FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copy dependency manifests and local package overrides first for layer caching
COPY package.json package-lock.json ./
COPY local-node-domexception ./local-node-domexception

RUN npm ci --no-audit --no-fund

# Copy application source and compile client (Vite) + server (esbuild)
COPY . .
RUN npm run build && npm prune --omit=dev

# ------------------------------------------------------------------------------
# Runtime Stage (Minimal Production Footprint)
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Install system Chromium + required shared libraries for Puppeteer scraping
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Create non-root runtime user
RUN groupadd --gid 1001 brokr \
  && useradd --uid 1001 --gid brokr --shell /usr/sbin/nologin --create-home brokr

ENV NODE_ENV=production \
    PORT=8080 \
    TRUST_PROXY_HOPS=1 \
    SHUTDOWN_TIMEOUT_MS=10000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy only production runtime artifacts from builder
COPY --from=builder --chown=brokr:brokr /app/package.json ./package.json
COPY --from=builder --chown=brokr:brokr /app/node_modules ./node_modules
COPY --from=builder --chown=brokr:brokr /app/dist ./dist
COPY --from=builder --chown=brokr:brokr /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=builder --chown=brokr:brokr /app/public ./public

USER brokr

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||8080;fetch('http://127.0.0.1:'+p+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
