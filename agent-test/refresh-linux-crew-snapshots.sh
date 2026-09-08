#!/usr/bin/env bash
# Refresh only the two new, uncommitted Crew snapshot owners in the private Linux checkout.
set -euo pipefail
task_root=/home/admin1/.cache/dsh-crew-web/run-oVU9c9Cd
checkout_root="$task_root/checkout"
test -d "$checkout_root/.git"
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
result_root=$(mktemp -d "$task_root/crew-snapshot-refresh-XXXXXXXX")
printf 'LINUX_CREW_SNAPSHOT_RESULTS=%s\n' "$result_root"
cd "$checkout_root"
cp -- /mnt/c/Users/admin/Desktop/workspace/deepseek-harness/snapshots/sdk/crew-projection/cordis.yml snapshots/sdk/crew-projection/cordis.yml
DSH_SNAPSHOT=refresh pnpm exec vitest run --config vitest.snapshot.config.ts \
  snapshots/crew-native/crew-native.snapshot.ts snapshots/sdk/sdk.snapshot.ts -t 'crew-native|crew-projection' \
  --reporter default --reporter json --outputFile "$result_root/refresh-results.json" > "$result_root/refresh.log" 2>&1
printf 'LINUX_CREW_SNAPSHOT_REFRESH_PASSED\n'
DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts \
  snapshots/crew-native/crew-native.snapshot.ts snapshots/sdk/sdk.snapshot.ts -t 'crew-native|crew-projection' \
  --reporter default --reporter json --outputFile "$result_root/replay-results.json" > "$result_root/replay.log" 2>&1
printf 'LINUX_CREW_SNAPSHOT_REPLAY_PASSED\n'
