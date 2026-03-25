#!/bin/sh
set -e

echo "Running database setup..."
cd /app/packages/db

# Try migrate deploy first (works for fresh DB or already-baselined DB)
# If it fails (e.g. existing DB without migration history), fall back to db push
if npx prisma migrate deploy 2>&1; then
  echo "Migrations applied successfully."
else
  echo "migrate deploy failed, falling back to db push..."
  npx prisma migrate deploy
  echo "Database schema pushed successfully."
fi

echo "Starting API server..."
cd /app/apps/api
exec node dist/main.js
