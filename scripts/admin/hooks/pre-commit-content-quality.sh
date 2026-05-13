#!/bin/sh
# pre-commit-content-quality.sh
#
# Drop into a content repo as .git/hooks/pre-commit and chmod +x.
# Designed for Astro / Next.js / similar static-site source under src/pages, src/components, src/layouts.
# No node, no python — only sh + grep + awk so it works in minimal environments.
#
# Override (only owner, very rarely): git commit --no-verify

set -e

# ── Layer 1: em-dashes ────────────────────────────────────────────
violations=$(git diff --cached --name-only --diff-filter=ACM \
  | grep -E '^(src/pages|src/components|src/layouts).*\.(astro|tsx|ts|jsx|js|md|html)$' \
  | xargs -I{} grep -Hn '—' {} 2>/dev/null || true)
if [ -n "$violations" ]; then
  echo "ERROR: em-dashes (—) detected in user-facing files. Use a regular hyphen (-) or colon (:) instead."
  echo "$violations"
  exit 1
fi

# ── Layer 2: AI-engine bot block in robots.txt ────────────────────
robots_diff=$(git diff --cached --diff-filter=ACM -- public/robots.txt dist/robots.txt 2>/dev/null || true)
if [ -n "$robots_diff" ]; then
  near_block=$(echo "$robots_diff" \
    | awk '/^\+User-agent:.*(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|CCBot|Applebot-Extended|Bytespider|Amazonbot|Meta-ExternalAgent)/{flag=1; print; next} flag && /^\+/{print; if (/Disallow:.*\//) bad=1; flag=0} END {exit !bad}' \
    && echo MATCH || true)
  if [ "$near_block" = "MATCH" ]; then
    echo "ERROR: robots.txt diff blocks an AI-engine bot."
    echo "AI Citation strategy requires these bots to crawl the site (chatgpt.com, perplexity.ai, claude.ai referrer traffic comes from humans clicking links inside AI answers)."
    echo "If you genuinely need this change, talk to the owner first."
    echo
    echo "$robots_diff" | grep -E '^\+' | head -10
    exit 1
  fi
fi

# ── Layer 3: site-wide noai/noindex meta robots in layouts ────────
meta_robots=$(git diff --cached --diff-filter=ACM -- 'src/layouts/*.astro' 'src/components/*.astro' 'src/pages/index.astro' 2>/dev/null \
  | grep -iE '^\+.*<meta.*name=["'"'"']robots["'"'"'].*content=["'"'"'][^"'"'"']*(noai|noimageai|noindex)' || true)
if [ -n "$meta_robots" ]; then
  echo "ERROR: site-wide layout introduces meta robots that excludes AI / search engines."
  echo "$meta_robots"
  exit 1
fi

# ── Layer 4: fabricated testing claims ────────────────────────────
truth_violations=$(git diff --cached --name-only --diff-filter=ACM \
  | grep -E '^src/pages.*\.astro$' \
  | xargs grep -HnE '(we tested|i tested|we spent|i spent|after testing|our [0-9]+[ -](day|week|month) test|tested [0-9]+\+? *(coaches|tutors|apps|channels|platforms|courses|videos)|put .* through [0-9]+ days|[0-9]+ days of (real )?testing)' 2>/dev/null \
  | head -20 || true)
if [ -n "$truth_violations" ]; then
  echo "ERROR: fabricated testing claim detected. Do not say 'tested N+', 'spent \$X', 'after N days of testing', etc unless that test actually happened."
  echo "If the testing genuinely happened, document it. Otherwise rewrite using 'reviewed', 'compared', 'analyzed' without false numbers."
  echo
  echo "$truth_violations"
  exit 1
fi

# ── Layer 5: SERP-truncation length gates ─────────────────────────
length_violations=""
for f in $(git diff --cached --name-only --diff-filter=ACM | grep -E '^src/pages.*\.astro$'); do
  while IFS= read -r line; do
    title_val=$(echo "$line" \
      | grep -oE '(const (title|pageTitle|pageTitleMain) *= *|<(Base|Guide) +title=)"[^"]+"' \
      | grep -oE '"[^"]+"$' | tr -d '"')
    if [ -n "$title_val" ]; then
      tlen=$(printf '%s' "$title_val" | wc -c)
      if [ "$tlen" -gt 62 ]; then
        length_violations="${length_violations}
$f: title $tlen chars (>62): $title_val"
      fi
    fi
    desc_val=$(echo "$line" \
      | grep -oE '(const (description|pageDescription) *= *|<(Base|Guide) +[^>]*description=)"[^"]+"' \
      | grep -oE '"[^"]+"$' | tr -d '"')
    if [ -n "$desc_val" ]; then
      dlen=$(printf '%s' "$desc_val" | wc -c)
      if [ "$dlen" -gt 165 ]; then
        length_violations="${length_violations}
$f: description $dlen chars (>165): $desc_val"
      fi
    fi
  done < "$f"
done
if [ -n "$length_violations" ]; then
  printf "ERROR: title/description length violation. Search engines truncate titles >62 and descriptions >165 chars.\n"
  printf '%s\n' "$length_violations"
  exit 1
fi

exit 0
