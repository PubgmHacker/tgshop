#!/usr/bin/env bash
#
# setup-webhook.sh — registers (or removes) the Telegram Bot API webhook for
# this shop's bot, using BOT_TOKEN / WEBHOOK_URL / WEBHOOK_SECRET from .env.
#
# Usage:
#   ./scripts/setup-webhook.sh set      # register the webhook (default)
#   ./scripts/setup-webhook.sh info      # print current webhook info
#   ./scripts/setup-webhook.sh delete    # remove the webhook (e.g. to switch to long polling)
#
# Requires: curl, jq (optional, for pretty output).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

: "${BOT_TOKEN:?BOT_TOKEN must be set (env or .env)}"

ACTION="${1:-set}"
API="https://api.telegram.org/bot${BOT_TOKEN}"

pretty() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

case "${ACTION}" in
  set)
    : "${WEBHOOK_URL:?WEBHOOK_URL must be set (env or .env)}"
    : "${WEBHOOK_SECRET:?WEBHOOK_SECRET must be set (env or .env)}"
    # WEBHOOK_URL is the PUBLIC BASE of the bot's HTTP server (e.g.
    # https://api.example.com), not a full path. The route itself is
    # /webhook/telegram/<secret>, and apps/bot/src/index.ts builds exactly the
    # same URL when it registers the webhook itself on boot. Both must agree,
    # or Telegram posts updates to a 404 and the bot silently receives nothing.
    FULL_URL="${WEBHOOK_URL%/}/webhook/telegram/${WEBHOOK_SECRET}"
    echo "[setup-webhook] Setting webhook to ${FULL_URL} ..."
    curl -sS -X POST "${API}/setWebhook" \
      -d "url=${FULL_URL}" \
      -d "secret_token=${WEBHOOK_SECRET}" \
      -d "allowed_updates=[\"message\",\"callback_query\",\"pre_checkout_query\",\"my_chat_member\",\"chat_member\"]" \
      -d "drop_pending_updates=false" | pretty
    ;;
  info)
    echo "[setup-webhook] Current webhook info:"
    curl -sS "${API}/getWebhookInfo" | pretty
    ;;
  delete)
    echo "[setup-webhook] Deleting webhook ..."
    curl -sS -X POST "${API}/deleteWebhook" -d "drop_pending_updates=false" | pretty
    ;;
  *)
    echo "Usage: $0 [set|info|delete]" >&2
    exit 1
    ;;
esac
