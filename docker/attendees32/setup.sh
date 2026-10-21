#!/usr/bin/env bash
# Prepares the Attendees server for the suite: its golden congregation, and the
# Tally integration provisioned against the congregation's youth group by the
# server's own setup command. The values that command prints go to
# /shared/a32.env, which playwright.config.ts reads when A32_ENV_FILE names it.
set -euo pipefail
cd /app

python manage.py migrate --noinput
python manage.py load_golden_data --seed --force --manifest /shared/golden-manifest.json
python manage.py setup_tally_integration \
  --organization-slug d7c8Fd_cfcc_hayward \
  --division-slug cfcch_crossing_ministry \
  --assembly-slug cfcch_crossing_youth \
  --meet-slug d7c8Fd_cfcch_crossing_youth_group \
  --character-slug golden_youth_student \
  | tee /shared/setup.log

# The printed block, without the base URL line: compose knows the address.
grep -E '^  A32_(TOKEN|DIVISION_ID|MEET_SLUG|CHARACTER_SLUG|ASSEMBLY_SLUG)=' /shared/setup.log \
  | sed 's/^  //' > /shared/a32.env
echo "Attendees is ready for Tally: $(wc -l < /shared/a32.env) values in /shared/a32.env"
