# BBH HMS – Public Website Dockerfile
# Runs PM2 in watch mode. File changes in /app (shared volume) trigger restart.

FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm pm2

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx build web --prod

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN npm install -g pm2

WORKDIR /app

# Create non-root user
RUN addgroup -g 1002 -S bbh-web && \
    adduser  -u 1002 -S bbh-web -G bbh-web

COPY --from=builder --chown=bbh-web:bbh-web /app/apps/web/.next      ./.next
COPY --from=builder --chown=bbh-web:bbh-web /app/apps/web/public      ./public
COPY --from=builder --chown=bbh-web:bbh-web /app/apps/web/package.json ./package.json
COPY --from=builder --chown=bbh-web:bbh-web /app/node_modules          ./node_modules
COPY --from=builder --chown=bbh-web:bbh-web /app/apps/web/ecosystem.config.js ./ecosystem.config.js

# PM2 logs directory
RUN mkdir -p /app/.pm2/logs && chown -R bbh-web:bbh-web /app/.pm2

USER bbh-web

EXPOSE 3000

# PM2 in watch mode – restarts when /app files change (Safe Update mechanism)
CMD ["pm2-runtime", "start", "ecosystem.config.js", "--env", "production"]
