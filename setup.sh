#!/usr/bin/env bash
# =============================================================================
# BBH HMS – Nx Monorepo Setup Script
# Run on a fresh Ubuntu 22.04/24.04 server or local dev machine.
# =============================================================================

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BBH HMS – Phase 1 Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
echo "[1/8] Checking prerequisites..."

command -v node >/dev/null 2>&1 || { echo "Node.js 20+ required. Install via nvm."; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "git is required."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required."; exit 1; }

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Node.js 20+ required. Found: $(node --version)"; exit 1
fi

# ── 2. Init Nx Workspace ──────────────────────────────────────────────────────
echo "[2/8] Initializing Nx monorepo..."

npx create-nx-workspace@latest bbh-hms \
  --preset=empty \
  --packageManager=pnpm \
  --nxCloud=skip \
  --no-interactive

cd bbh-hms

# ── 3. Install Nx Plugins ─────────────────────────────────────────────────────
echo "[3/8] Installing Nx plugins..."

pnpm add -D \
  @nx/nest \
  @nx/next \
  @nx/js \
  @nx/eslint \
  nx-prisma

# ── 4. Generate Applications ──────────────────────────────────────────────────
echo "[4/8] Generating NestJS API app..."

npx nx g @nx/nest:app apps/api \
  --framework=fastify \
  --no-interactive

echo "[4/8] Generating Next.js Admin panel..."
npx nx g @nx/next:app apps/admin \
  --appDir=true \
  --style=tailwind \
  --no-interactive

echo "[4/8] Generating Next.js Public Website..."
npx nx g @nx/next:app apps/web \
  --appDir=true \
  --style=tailwind \
  --no-interactive

# ── 5. Generate Shared Libraries ──────────────────────────────────────────────
echo "[5/8] Generating shared libraries..."

npx nx g @nx/js:lib libs/prisma      --no-interactive
npx nx g @nx/js:lib libs/auth        --no-interactive
npx nx g @nx/js:lib libs/storage     --no-interactive
npx nx g @nx/js:lib libs/audit       --no-interactive
npx nx g @nx/js:lib libs/updater     --no-interactive

# ── 6. Install Backend Dependencies ───────────────────────────────────────────
echo "[6/8] Installing backend dependencies..."

pnpm add \
  @nestjs/common \
  @nestjs/core \
  @nestjs/platform-fastify \
  @nestjs/config \
  fastify \
  @fastify/session \
  @fastify/cookie \
  @fastify/helmet \
  connect-redis \
  ioredis \
  redis \
  argon2 \
  @prisma/client \
  @aws-sdk/client-s3 \
  @aws-sdk/s3-request-presigner \
  nestjs-pino \
  pino-http \
  uuid \
  class-validator \
  class-transformer \
  pm2

pnpm add -D \
  prisma \
  @types/node \
  @types/uuid \
  typescript \
  pino-pretty \
  ts-node

# ── 7. Install Frontend Dependencies ─────────────────────────────────────────
echo "[7/8] Installing frontend dependencies..."

pnpm add \
  next \
  react \
  react-dom \
  tailwindcss \
  shadcn-ui \
  @radix-ui/react-slot \
  @radix-ui/react-dialog \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-label \
  @radix-ui/react-separator \
  @radix-ui/react-toast \
  lucide-react \
  clsx \
  tailwind-merge \
  next-themes

pnpm add -D \
  @types/react \
  @types/react-dom \
  autoprefixer \
  postcss

# ── 8. Prisma Setup ───────────────────────────────────────────────────────────
echo "[8/8] Setting up Prisma..."

mkdir -p libs/prisma
# (Copy schema.prisma from deliverables to libs/prisma/schema.prisma)
# npx prisma generate --schema=libs/prisma/schema.prisma

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Nx monorepo initialized!"
echo ""
echo "  Next steps:"
echo "  1. Copy deliverable files into the appropriate directories."
echo "  2. cp .env.example .env && nano .env   (fill in secrets)"
echo "  3. docker compose up -d"
echo "  4. docker exec bbh-api npx prisma migrate deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
