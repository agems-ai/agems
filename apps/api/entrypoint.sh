#!/bin/sh
set -e

echo "Running database setup..."
cd /app/packages/db

# Try migrate deploy first (works for fresh DB or already-baselined DB)
# If it fails, only allow db push fallback when explicitly enabled
if npx prisma migrate deploy 2>&1; then
  echo "Migrations applied successfully."
else
  if [ "$ALLOW_PRISMA_DB_PUSH_FALLBACK" = "true" ]; then
    echo "migrate deploy failed, falling back to db push because ALLOW_PRISMA_DB_PUSH_FALLBACK=true..."
    npx prisma db push --skip-generate --accept-data-loss
    echo "Database schema pushed successfully."
  else
    echo "migrate deploy failed and db push fallback is disabled."
    echo "Set ALLOW_PRISMA_DB_PUSH_FALLBACK=true only for controlled recovery scenarios."
    exit 1
  fi
fi

echo "Starting API server..."
cd /app/apps/api
exec node dist/main.js
