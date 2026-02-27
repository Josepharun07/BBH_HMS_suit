# BBH HMS — Hotel Management Suite
### Phase 1: Secure Infrastructure & Core Kernel

> A production-grade, self-hosted, all-in-one hotel management ecosystem built on a Nx Monorepo. Runs 100% on-premise or on a private VPS with zero dependency on paid cloud services.

---

## Architecture Overview

```
                        ┌────────────────────┐
                        │   Traefik v3 (TLS)  │
                        │   Port 80/443       │
                        └─────────┬──────────┘
                                  │ Routes by Host header
        ┌─────────────────────────┼──────────────────────────┐
        │                         │                          │
   yourdomain.com         api.yourdomain.com       admin.yourdomain.com
        │                         │                          │
   bbh-website              bbh-api (NestJS)          bbh-admin (Next.js)
   (Next.js + PM2)          Fastify, UID 1001          Staff Panel
        │                         │
        │                    service-net (internal)
        │               ┌─────────┴──────────┐
        │           PostgreSQL 16         Redis 7
        │           (Prisma ORM)     (Sessions/Cache)
        │                                    
        └──────── [Shared Volume: website-source-code] ──────┘
                  /mnt/website (API writes)
                  /app         (PM2 reads & watches)
```

### The "Safe Update" Flow

```
Admin Dashboard
      │
      ▼ POST /api/admin/updater/pull
bbh-api (UID 1001, non-root)
      │
      ▼ git pull --ff-only (inside /mnt/website)
Shared Docker Volume (website-source-code)
      │
      ▼ File change detected
PM2 Watch Mode (bbh-website container)
      │
      ▼ Automatic process restart
Updated guest website live ✓
```

**Security contract:** The API never touches the Docker socket. It never runs as root. It executes exactly one command (`git pull`) inside a path-validated, pre-approved directory.

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Monorepo | Nx | Code organization, build caching |
| Backend | NestJS + Fastify | High-performance API |
| Frontend | Next.js 14 (App Router) | Admin panel + Guest website |
| UI | Shadcn/UI + Tailwind | Design system |
| Database | PostgreSQL 16 | Primary data store |
| ORM | Prisma | Type-safe DB access |
| Cache/Sessions | Redis 7 | Session store (instant revocation) |
| Object Storage | MinIO | S3-compatible self-hosted storage |
| Gateway | Traefik v3 | Reverse proxy + auto TLS |
| Telemetry | Prometheus + Grafana | Metrics and visualization |
| Auth | Argon2id + Redis Sessions | Password hashing + session management |
| Process Manager | PM2 | Website auto-reload on code change |
| Logging | Pino | Structured JSON logging |

---

## Server Requirements

- **OS:** Ubuntu 22.04 LTS or 24.04 LTS (64-bit)
- **RAM:** 4GB minimum, 8GB recommended
- **CPU:** 2 vCPUs minimum
- **Storage:** 40GB SSD minimum
- **Network:** A domain name with DNS A records configured

### DNS Records Required

```
A    yourdomain.com        → <server-ip>
A    api.yourdomain.com    → <server-ip>
A    admin.yourdomain.com  → <server-ip>
A    storage.yourdomain.com → <server-ip>
A    minio.yourdomain.com  → <server-ip>
A    metrics.yourdomain.com → <server-ip>
A    traefik.yourdomain.com → <server-ip>
```

---

## Deployment Guide (Fresh Ubuntu Server)

### Step 1 — Server Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y curl git htpasswd

# Install Docker Engine
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Install Node.js 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Install pnpm
npm install -g pnpm

# Verify installations
docker --version   # Docker 25+
node --version     # v20+
pnpm --version     # 8+
```

### Step 2 — Clone the Repository

```bash
git clone https://your-git-repo/bbh-hms.git
cd bbh-hms
```

### Step 3 — Configure Environment

```bash
cp .env.example .env
nano .env
```

Fill in **every** value:

```bash
# Required: Your domain
DOMAIN=yourdomain.com
ACME_EMAIL=admin@yourdomain.com

# Generate Traefik basic auth password:
htpasswd -nb admin 'YOUR_TRAEFIK_PASSWORD'
# Copy the output into TRAEFIK_BASIC_AUTH (escape $ as $$)
TRAEFIK_BASIC_AUTH=admin:$$2y$$10$$...

# Generate session secret:
openssl rand -hex 64
SESSION_SECRET=<paste output here>

# Set strong, unique passwords for all services
POSTGRES_PASSWORD=<strong-password>
REDIS_PASSWORD=<strong-password>
MINIO_ROOT_PASSWORD=<strong-password>
```

### Step 4 — Initialize Nx Workspace & Install Dependencies

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

Or manually:

```bash
# Install all dependencies
pnpm install

# Generate Prisma client
pnpm prisma generate --schema=libs/prisma/schema.prisma
```

### Step 5 — Create Required Directories

```bash
mkdir -p infra/letsencrypt
chmod 600 infra/letsencrypt
mkdir -p infra/grafana/provisioning
```

### Step 6 — Build & Launch

```bash
# Build all Docker images
docker compose build

# Start infrastructure (without app containers first)
docker compose up -d traefik postgres redis minio

# Wait for healthy status
docker compose ps

# Run database migrations
docker compose run --rm bbh-api npx prisma migrate deploy \
  --schema=prisma/schema.prisma

# Start all services
docker compose up -d

# Verify all containers are running
docker compose ps
```

### Step 7 — Seed Initial Owner Account

```bash
docker compose exec bbh-api node -e "
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

async function seed() {
  const prisma = new PrismaClient();
  const hash = await argon2.hash('CHANGE_THIS_PASSWORD', {
    type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4
  });
  await prisma.user.create({
    data: {
      email: 'owner@yourdomain.com',
      password_hash: hash,
      first_name: 'Hotel',
      last_name: 'Owner',
      role: 'OWNER',
    }
  });
  console.log('Owner account created');
  await prisma.\$disconnect();
}
seed();
"
```

### Step 8 — Configure MinIO Public Bucket Policy

```bash
# Install MinIO client inside the container
docker compose exec minio mc alias set local http://localhost:9000 \
  $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD

docker compose exec minio mc anonymous set public local/bbh-public
```

### Step 9 — Configure Website Git Repository

```bash
# Initialize the website source on the shared volume
docker compose exec bbh-api sh -c "
  cd /mnt/website && \
  git clone https://your-git-repo/bbh-website.git . && \
  git config pull.rebase false
"
```

---

## Verification Checklist

```bash
# All containers running
docker compose ps

# API health check
curl https://api.yourdomain.com/api/public/config

# Check logs
docker compose logs bbh-api --tail=50
docker compose logs bbh-website --tail=50

# Database connectivity
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "\dt"

# Redis connectivity
docker compose exec redis redis-cli -a $REDIS_PASSWORD ping
```

---

## Role-Based Access Control

| Role | Access Level |
|------|-------------|
| `OWNER` | Full system access. All modules. Can deactivate any user. |
| `MANAGER` | Property management, reports, staff management, config. |
| `FRONT_DESK` | Reservations, check-in/out, guest communication. |
| `HOUSEKEEPING` | Room status updates, housekeeping schedules. |
| `KITCHEN` | Kitchen order queue, menu items (when KITCHEN module enabled). |
| `MAINTENANCE` | Maintenance requests, equipment logs. |

### Instant Session Revocation

When a staff member is deactivated:

1. Navigate to **Admin Panel → Staff → [User] → Deactivate**
2. The API sets `is_active = false` in PostgreSQL
3. **Every subsequent request** from that user checks `is_active` against the DB
4. The session is immediately invalid — no need to wait for Redis TTL expiry

```typescript
// AuthGuard re-validates on every request:
const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
if (!user || !user.is_active) throw new UnauthorizedException();
```

---

## Module System

Enable or disable features via the Admin Panel → **Modules**:

```
RESTAURANT  – POS, table management, menu
SPA         – Appointment booking, therapist schedules
KITCHEN     – Kitchen display system, order management
HOUSEKEEPING – Room inspection, laundry tracking
MAINTENANCE – Work orders, equipment maintenance
EVENTS      – Function rooms, event catering
POS         – Point of sale terminal
```

The sidebar navigation in the Admin Panel dynamically renders only enabled modules.

---

## Updating the Guest Website (Safe Update)

1. Push new code to your website Git repository
2. Open **Admin Panel → Settings → Website**
3. Click **"Update Website"**
4. The API pulls the latest code into the shared volume
5. PM2 detects file changes and restarts the Next.js process
6. The guest website is updated — no Docker commands, no root access required

---

## Monitoring

| Service | URL |
|---------|-----|
| Grafana Dashboard | `https://metrics.yourdomain.com` |
| Traefik Dashboard | `https://traefik.yourdomain.com` |
| MinIO Console | `https://minio.yourdomain.com` |

Prometheus scrapes metrics from Traefik, the API, PostgreSQL exporter, and Redis exporter every 15 seconds. Data is retained for 30 days.

---

## Backup Strategy

```bash
# Database backup (run nightly via cron)
docker compose exec -T postgres pg_dump \
  -U $POSTGRES_USER $POSTGRES_DB \
  | gzip > /backups/bbh-hms-$(date +%Y%m%d).sql.gz

# MinIO data backup
# Mount the minio-data volume and sync to an external location.
# Or use: mc mirror local/bbh-private /backups/minio/
```

Recommended cron (edit with `crontab -e`):
```
0 2 * * * /opt/bbh-hms/scripts/backup.sh >> /var/log/bbh-backup.log 2>&1
```

---

## Security Notes

- **All containers run as non-root users** (UID 1001/1002)
- **CORS** is restricted to `yourdomain.com` and `admin.yourdomain.com`
- **Sessions** are `httpOnly`, `secure`, `sameSite: strict` (8-hour TTL)
- **Passwords** are hashed with Argon2id (OWASP recommended params)
- **Audit Log** captures every significant action with IP address, user agent, and before/after values
- **Traefik** enforces HTTPS via Let's Encrypt with HSTS headers
- **Helmet** sets Content-Security-Policy, X-Frame-Options, X-Content-Type-Options

---

## Project Structure

```
bbh-hms/
├── apps/
│   ├── api/               # NestJS backend (Fastify)
│   │   ├── Dockerfile
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   └── config/        # GlobalConfig controller
│   ├── admin/             # Next.js staff panel
│   │   └── Dockerfile
│   └── web/               # Next.js public guest site
│       ├── Dockerfile
│       └── ecosystem.config.js  # PM2 watch config
├── libs/
│   ├── prisma/
│   │   └── schema.prisma  # Full DB schema
│   ├── auth/
│   │   ├── auth.service.ts     # Session auth logic
│   │   ├── auth.guard.ts       # Request guard
│   │   ├── roles.guard.ts      # RBAC guard
│   │   └── auth.controller.ts  # Login/logout/me
│   ├── storage/
│   │   └── storage.service.ts  # MinIO wrapper
│   ├── audit/
│   │   └── audit.service.ts    # Audit logging
│   └── updater/
│       └── updater.service.ts  # Safe git pull
├── infra/
│   ├── prometheus/
│   │   └── prometheus.yml
│   └── grafana/
├── scripts/
│   └── setup.sh           # One-command setup
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Phase 2 Roadmap

- **Booking Engine** — Room inventory, availability calendar, reservation management
- **POS Module** — Point-of-sale for restaurant, bar, and gift shop
- **Housekeeping Module** — Room inspection workflow, laundry tracking
- **Guest Portal** — Self-service check-in, room service requests, feedback
- **Reporting Engine** — Revenue reports, occupancy rates, duty logs

---

*BBH HMS is built for sovereignty. Your data never leaves your infrastructure.*
