#!/usr/bin/env bash
# Deploy MindForum to the VPS. Run from /root/repos/mindforum on the host.
# Idempotent. Safe to re-run.

set -euo pipefail

cd /root/repos/mindforum

echo "==> Cleaning local package-lock.json (npm install dirties it)"
git checkout -- package-lock.json || true

echo "==> Fetching origin/main"
# reset --hard, not pull: the host is a deploy target, not a place to author
# changes. A pull can stop on a diverged branch and wedge an unattended deploy.
git fetch origin main --quiet
git reset --hard origin/main

echo "==> Installing dependencies"
# ci is reproducible and honors the lockfile; fall back if the lockfile is absent.
npm ci --silent 2>/dev/null || npm install --silent

echo "==> Running schema migrations (idempotent)"
npm run migrate

echo "==> Building"
npm run build

echo "==> Restarting PM2 process"
pm2 restart mindforum --update-env

echo "==> Health check"
# Retry: the app can still be booting. A single attempt gives false failures.
sleep 2
for i in 1 2 3 4 5; do
  if curl -fsS --max-time 5 http://localhost:3006/ > /dev/null 2>&1; then
    echo "OK: app responded on :3006"
    # Sentinel LAST, on the success path only, so a freshness monitor can
    # alert when a deploy silently stops happening. Logging is not alerting.
    mkdir -p "$HOME/.deploy-sentinels"
    touch "$HOME/.deploy-sentinels/mindforum"
    exit 0
  fi
  echo "    not responding yet ($i/5)..."
  sleep 3
done

echo "FAIL: app did not respond on :3006 — recent logs follow"
pm2 logs mindforum --lines 30 --nostream 2>/dev/null || true
exit 1
