# syntax=docker/dockerfile:1

# ─── Build ──────────────────────────────────────────────────
# Compiles src/ → dist/ with tsc, then prunes devDependencies so the runtime
# stage can reuse this same node_modules (keeps bcrypt's compiled binary).
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Chromium comes from the OS package in the runtime stage — skip puppeteer's
# own ~170MB download.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# node-gyp toolchain: `bcrypt` ships no prebuilt binary for Node 22 and falls
# back to compiling from source. Never reaches the final image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ─── Runtime ────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + fonts for the PDF invoices in invoice.service.ts.
# curl is here for the orchestrator's health check — the slim base ships
# neither curl nor wget, so without it every health probe fails.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      ca-certificates \
      curl \
      dumb-init \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Served statically at /uploads (app.ts). Mount a Coolify persistent volume
# here or every redeploy wipes the uploaded materials.
RUN mkdir -p /app/uploads/materials && chown -R node:node /app/uploads

USER node
EXPOSE 5000

# PID 1 that reaps the zombie processes Chromium leaves behind.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
