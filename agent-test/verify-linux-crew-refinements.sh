#!/usr/bin/env bash
# Verify the latest native Crew source and its Web panel after the complete Web replay.
set -euo pipefail
task_root=/home/admin1/.cache/dsh-crew-web/run-oVU9c9Cd
source_root=/mnt/c/Users/admin/Desktop/workspace/deepseek-harness
checkout_root="$task_root/checkout"
test -d "$checkout_root/.git"
for owner in packages/experimental/crew packages/experimental/tool-crew packages/experimental/client-ui-crew; do
  rsync -a --exclude node_modules --exclude lib --exclude dist "$source_root/$owner/" "$checkout_root/$owner/"
done
cp -- "$source_root/pnpm-lock.yaml" "$checkout_root/pnpm-lock.yaml"
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
export LD_LIBRARY_PATH="$task_root/browser-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
result_root=$(mktemp -d "$task_root/crew-refinements-XXXXXXXX")
printf 'LINUX_CREW_REFINEMENT_RESULTS=%s\n' "$result_root"
cd "$checkout_root"
pnpm install --frozen-lockfile --offline --ignore-scripts > "$result_root/install.log" 2>&1
pnpm exec vitest run packages/experimental/crew/tests packages/experimental/tool-crew/tests \
  --reporter default --reporter json --outputFile "$result_root/unit-results.json" > "$result_root/unit.log" 2>&1
printf 'LINUX_CREW_REFINEMENT_UNIT_PASSED\n'
pnpm run build > "$result_root/build.log" 2>&1
printf 'LINUX_CREW_REFINEMENT_BUILD_PASSED\n'
DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/crew-panel.e2e.ts \
  --reporter default --reporter json --outputFile "$result_root/web-results.json" > "$result_root/web.log" 2>&1
printf 'LINUX_CREW_REFINEMENT_WEB_PASSED\n'
