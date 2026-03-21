#!/bin/bash
# AGEMS onboarding script wrapper
# Usage: bash scripts/onboard.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

# Check if tsx is available
if command -v npx &> /dev/null; then
  npx tsx scripts/onboard.ts
else
  echo "Error: npx not found. Please install Node.js >= 20 and pnpm first."
  exit 1
fi
