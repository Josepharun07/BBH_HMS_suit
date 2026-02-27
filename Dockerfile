# BBH HMS – API Dockerfile
# Multi-stage build. Final image runs as non-root user (UID 1001).

FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY libs/ libs/
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm prisma generate --schema=libs/prisma/schema.prisma
RUN pnpm nx build api --prod

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Create non-root user (UID/GID 1001) – THE SECURITY REQUIREMENT
RUN addgroup -g 1001 -S bbh && \
    adduser  -u 1001 -S bbh -G bbh

# Install git (required for "Safe Update" git pull)
RUN apk add --no-cache git

COPY --from=builder --chown=bbh:bbh /app/dist/apps/api ./dist
COPY --from=builder --chown=bbh:bbh /app/node_modules  ./node_modules
COPY --from=builder --chown=bbh:bbh /app/libs/prisma/schema.prisma ./prisma/schema.prisma

# Create the website mount point with correct ownership
RUN mkdir -p /mnt/website && chown bbh:bbh /mnt/website

USER bbh

EXPOSE 3333
CMD ["node", "dist/main.js"]
