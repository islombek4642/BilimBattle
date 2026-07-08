#!/bin/bash
# BilimBattle Production Deployment Script
# Run on the server: bash scripts/deploy.sh

set -e  # Exit on error

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo -e "${GREEN}=== BilimBattle Production Deployment ===${NC}"
echo "Project directory: $PROJECT_DIR"
echo ""

# Step 1: Pre-flight checks
echo -e "${YELLOW}[1/7] Pre-flight checks...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker not installed. Installing...${NC}"
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    echo -e "${YELLOW}Please log out and back in, then re-run this script.${NC}"
    exit 1
fi

if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
        cp .env.example .env
        echo -e "${RED}Created .env from .env.example. Edit it with real values (domains, DB password, JWT secret, bot token) before re-running!${NC}"
        exit 1
    else
        echo -e "${RED}.env and .env.example not found! Cannot proceed.${NC}"
        exit 1
    fi
fi

# Read DB_USER/DB_NAME from .env once, up front - reused by both the backup
# step and the seed-check step below, so they can never drift out of sync
# with each other or silently fall back to the wrong defaults.
DB_USER_VAL=$(grep -E '^DB_USER=' .env | cut -d '=' -f2-)
DB_USER_VAL=${DB_USER_VAL:-postgres}
DB_NAME_VAL=$(grep -E '^DB_NAME=' .env | cut -d '=' -f2-)
DB_NAME_VAL=${DB_NAME_VAL:-bilimbattle}

# Step 2: Backup current state
echo -e "${YELLOW}[2/7] Creating backup...${NC}"
BACKUP_NAME="backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p backups
if sudo docker ps --format '{{.Names}}' | grep -q 'bilimbattle_db'; then
    sudo docker exec bilimbattle_db pg_dump -U "${DB_USER_VAL}" "${DB_NAME_VAL}" | gzip > "backups/${BACKUP_NAME}.sql.gz" 2>/dev/null && \
    echo -e "${GREEN}DB backup created: backups/${BACKUP_NAME}.sql.gz${NC}" || \
    echo -e "${YELLOW}DB backup failed (maybe first deploy, DB not up yet)${NC}"

    # Keep only the 7 most recent backups
    ls -t backups/*.sql.gz 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null || true
else
    echo -e "${YELLOW}DB backup skipped (container not running yet - first deploy)${NC}"
fi

# Step 3: Pull latest code
echo -e "${YELLOW}[3/7] Pulling latest code...${NC}"
git stash
git pull origin master
git stash pop 2>/dev/null || true

# Step 4: Ensure the external proxy_network exists (nginx-proxy depends on it)
echo -e "${YELLOW}[4/7] Checking proxy_network...${NC}"
if ! sudo docker network inspect proxy_network &>/dev/null; then
    echo -e "${YELLOW}Creating proxy_network (required for nginx-proxy)...${NC}"
    sudo docker network create proxy_network
else
    echo "proxy_network already exists."
fi

# Step 5: Rebuild and restart containers
echo -e "${YELLOW}[5/7] Rebuilding Docker containers...${NC}"
sudo docker compose down
sudo docker compose up -d --build

echo "Waiting for containers to initialize..."
sleep 15
sudo docker compose ps

# Step 6: Database migrations + one-time seed
# node dist/src/... (not dist/...) - tsconfig.json's rootDir/include (src,
# scripts, tests) makes tsc mirror the full input path under outDir.
echo -e "${YELLOW}[6/7] Running database migrations...${NC}"
sudo docker compose exec -T api node dist/src/db/migrate.js || echo -e "${RED}Migration failed! Check logs.${NC}"

echo "Checking whether question seed data is needed..."
QUESTION_COUNT=$(sudo docker compose exec -T db psql -U "${DB_USER_VAL}" -d "${DB_NAME_VAL}" -tAc "SELECT count(*) FROM questions;" 2>/dev/null || echo "0")
if [[ "$QUESTION_COUNT" -eq 0 ]]; then
    echo "No questions found - seeding (this only runs once, seed.ts is not safe to re-run)..."
    sudo docker compose exec -T api node dist/src/db/seed.js || echo -e "${RED}Seeding failed! Check logs.${NC}"
else
    echo "Questions table already has ${QUESTION_COUNT} rows - skipping seed."
fi

# Step 7: Health checks
echo -e "${YELLOW}[7/7] Running health checks...${NC}"

MAX_RETRIES=10
RETRY_COUNT=0
HEALTHY=false
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    HTTP_CODE=$(sudo docker compose exec -T api node -e "require('http').get('http://localhost:3000/health',r=>{process.stdout.write(String(r.statusCode))}).on('error',()=>process.stdout.write('000'))" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        HEALTHY=true
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -n "."
    sleep 3
done

echo ""
if [ "$HEALTHY" = true ]; then
    echo -e "${GREEN}API is healthy (Status: 200) after $RETRY_COUNT retries.${NC}"
else
    echo -e "${RED}API health check failed after $MAX_RETRIES attempts (Last Status: $HTTP_CODE). Check: sudo docker compose logs api${NC}"
fi

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo "Global nginx-proxy will automatically handle SSL and routing."
DOMAIN_VAL=$(grep -E '^WEBAPP_DOMAIN=' .env | cut -d '=' -f2- || echo "")
API_DOMAIN_VAL=$(grep -E '^API_DOMAIN=' .env | cut -d '=' -f2- || echo "")
echo "Test: curl -I https://${DOMAIN_VAL}"
echo "Test: curl -I https://${API_DOMAIN_VAL}/health"
echo ""
