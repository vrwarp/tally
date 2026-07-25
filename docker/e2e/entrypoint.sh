#!/usr/bin/env bash
#
# Runs the Tally end-to-end suite. Any arguments are passed straight through to
# `playwright test`, so:
#
#   docker run --rm tally-e2e                          # every project
#   docker run --rm tally-e2e --project=webkit-desktop  # just one
#
set -euo pipefail

# When a containerised suite fails, the first question is always "which browser
# build was that". Answer it before anything can go wrong.
echo "── Tally end-to-end ────────────────────────────────────────────────"
echo "node        $(node --version)"
echo "playwright  $(npx playwright --version)"
echo "java        $(java -version 2>&1 | head -n1)"
echo "chromium    $(npx playwright install --dry-run chromium 2>/dev/null | grep -i 'version' | head -n1 || echo 'bundled')"
echo "────────────────────────────────────────────────────────────────────"

# Playwright's own webServer config starts the Planning Center simulator, the
# Firebase emulators and the app preview. Nothing else to orchestrate here.
exec npx playwright test "$@"
