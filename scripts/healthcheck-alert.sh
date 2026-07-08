#!/bin/bash
# BilimBattle uptime watchdog - checks both public endpoints and sends a
# Telegram DM to the admin only on a STATE CHANGE (up->down or down->up),
# never on every run, so a genuinely-down server doesn't spam the admin
# once per cron tick until it's fixed.
#
# Setup (one-time):
#   1. Add ADMIN_TELEGRAM_ID=<your numeric Telegram user id> to .env
#      (message @userinfobot on Telegram to find your own id).
#   2. Add a cron entry to run this every 5 minutes:
#        */5 * * * * cd /root/BilimBattle && bash scripts/healthcheck-alert.sh >> /var/log/bilimbattle-healthcheck.log 2>&1
#      (crontab -e, then paste the line above, adjusting the repo path if
#      it isn't cloned to /root/BilimBattle)

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ ! -f .env ]]; then
    echo "healthcheck-alert: .env not found, skipping." >&2
    exit 0
fi

WEBAPP_DOMAIN=$(grep -E '^WEBAPP_DOMAIN=' .env | cut -d '=' -f2-)
API_DOMAIN=$(grep -E '^API_DOMAIN=' .env | cut -d '=' -f2-)
BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | cut -d '=' -f2-)
ADMIN_ID=$(grep -E '^ADMIN_TELEGRAM_ID=' .env | cut -d '=' -f2-)

if [[ -z "$BOT_TOKEN" || -z "$ADMIN_ID" ]]; then
    echo "healthcheck-alert: TELEGRAM_BOT_TOKEN or ADMIN_TELEGRAM_ID not set in .env, skipping." >&2
    exit 0
fi

STATE_FILE="$PROJECT_DIR/.healthcheck_state"
PREVIOUS_STATE=$(cat "$STATE_FILE" 2>/dev/null || echo "up")

send_telegram_message() {
    local text="$1"
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -d "chat_id=${ADMIN_ID}" \
        -d "text=${text}" \
        > /dev/null
}

check_url() {
    local url="$1"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" || echo "000")
    [[ "$code" == "200" ]]
}

FRONTEND_OK=false
API_OK=false
check_url "https://${WEBAPP_DOMAIN}" && FRONTEND_OK=true
check_url "https://${API_DOMAIN}/health" && API_OK=true

if [[ "$FRONTEND_OK" == true && "$API_OK" == true ]]; then
    CURRENT_STATE="up"
else
    CURRENT_STATE="down"
fi

if [[ "$CURRENT_STATE" != "$PREVIOUS_STATE" ]]; then
    if [[ "$CURRENT_STATE" == "down" ]]; then
        DETAIL=""
        [[ "$FRONTEND_OK" == false ]] && DETAIL="${DETAIL}- Frontend (https://${WEBAPP_DOMAIN}) javob bermayapti%0A"
        [[ "$API_OK" == false ]] && DETAIL="${DETAIL}- Backend (https://${API_DOMAIN}/health) javob bermayapti%0A"
        send_telegram_message "BilimBattle: muammo aniqlandi.%0A${DETAIL}"
        echo "$(date): DOWN - alert sent"
    else
        send_telegram_message "BilimBattle: qayta tiklandi, hammasi ishlayapti."
        echo "$(date): RECOVERED - alert sent"
    fi
    echo "$CURRENT_STATE" > "$STATE_FILE"
else
    echo "$(date): state unchanged ($CURRENT_STATE)"
fi
