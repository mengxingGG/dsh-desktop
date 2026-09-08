#!/usr/bin/env bash
# Replay the Crew Web scenario against the private checkout's latest completed build.
set -euo pipefail
task_root=/home/admin1/.cache/dsh-crew-web/run-oVU9c9Cd
checkout_root="$task_root/checkout"
test -d "$checkout_root/.git"
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
export LD_LIBRARY_PATH="$task_root/browser-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
result_root=$(mktemp -d "$task_root/crew-web-final-XXXXXXXX")
printf 'LINUX_CREW_WEB_RESULTS=%s\n' "$result_root"
cd "$checkout_root"
DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/crew-panel.e2e.ts \
  --reporter default --reporter json --outputFile "$result_root/web-results.json" > "$result_root/web.log" 2>&1
printf 'LINUX_CREW_WEB_PASSED\n'
