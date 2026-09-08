#!/usr/bin/env bash
# Check built native Crew delivery and both affected Session snapshot families without refresh.
set -euo pipefail
task_root=/home/admin1/.cache/dsh-crew-web/run-oVU9c9Cd
source_root=/mnt/c/Users/admin/Desktop/workspace/deepseek-harness
checkout_root="$task_root/checkout"
test -d "$checkout_root/.git"
for owner in packages/fs/fs packages/fs/fs-local packages/experimental/crew packages/experimental/tool-crew snapshots/crew-native snapshots/sdk/crew-projection; do
  rsync -a --exclude node_modules --exclude lib --exclude dist "$source_root/$owner/" "$checkout_root/$owner/"
done
cp -- "$source_root/apps/cli/tests/crew-native-headless.e2e.ts" "$checkout_root/apps/cli/tests/crew-native-headless.e2e.ts"
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
result_root=$(mktemp -d "$task_root/crew-delivery-XXXXXXXX")
printf 'LINUX_CREW_DELIVERY_RESULTS=%s\n' "$result_root"
cd "$checkout_root"
pnpm exec vitest run packages/experimental/crew/tests packages/experimental/tool-crew/tests \
  --reporter default --reporter json --outputFile "$result_root/unit-results.json" > "$result_root/unit.log" 2>&1
printf 'LINUX_CREW_DELIVERY_UNIT_PASSED\n'
if [[ "${1:-}" != --built ]]; then
  pnpm run build > "$result_root/build.log" 2>&1
  printf 'LINUX_CREW_DELIVERY_BUILD_PASSED\n'
fi
pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/crew-native-headless.e2e.ts \
  --reporter default --reporter json --outputFile "$result_root/delivery-results.json" > "$result_root/delivery.log" 2>&1
printf 'LINUX_CREW_DELIVERY_PASSED\n'
DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts -t 'crew-native|crew-projection' \
  --reporter default --reporter json --outputFile "$result_root/snapshot-results.json" > "$result_root/snapshot.log" 2>&1
printf 'LINUX_CREW_DELIVERY_SNAPSHOTS_PASSED\n'
