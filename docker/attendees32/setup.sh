#!/usr/bin/env bash
# Prepares the Attendees server for the suite: its golden congregation, and the
# Tally integration provisioned by the server's own setup command, with the
# congregation's youth group readable for the history import. The values that
# command prints go to /shared/a32.env, which playwright.config.ts reads when
# A32_ENV_FILE names it.
set -euo pipefail
cd /app

YOUTH_GROUP=d7c8Fd_cfcch_crossing_youth_group

python manage.py migrate --noinput
python manage.py load_golden_data --seed --force --manifest /shared/golden-manifest.json
python manage.py setup_tally_integration \
  --organization-slug d7c8Fd_cfcc_hayward \
  --readable-meet "$YOUTH_GROUP" \
  | tee /shared/setup.log

# The printed block, without the base URL line: compose knows the address.
# The meet is the suite's own knowledge, for the history import test.
{
  grep -E '^  A32_(TOKEN|DIVISION_ID)=' /shared/setup.log | sed 's/^  //'
  echo "A32_MEET_SLUG=$YOUTH_GROUP"
} > /shared/a32.env
echo "Attendees is ready for Tally: $(wc -l < /shared/a32.env) values in /shared/a32.env"
