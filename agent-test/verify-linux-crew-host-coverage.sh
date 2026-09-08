#!/usr/bin/env bash
# Measure the complete Crew host source without lowering the repository coverage thresholds.
set -euo pipefail
task_root=/home/admin1/.cache/dsh-crew-web/run-oVU9c9Cd
source_root=/mnt/c/Users/admin/Desktop/workspace/deepseek-harness
checkout_root="$task_root/checkout"
test -d "$checkout_root/.git"
cmp -- "$source_root/packages/experimental/crew/src/host.ts" "$checkout_root/packages/experimental/crew/src/host.ts"
cmp -- "$source_root/packages/experimental/crew/tests/host.spec.ts" "$checkout_root/packages/experimental/crew/tests/host.spec.ts"
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
result_root=$(mktemp -d "$task_root/crew-host-coverage-XXXXXXXX")
printf 'LINUX_CREW_HOST_COVERAGE_RESULTS=%s\n' "$result_root"
cd "$checkout_root"
pnpm exec vitest run packages/experimental/crew/tests packages/experimental/tool-crew/tests \
  --coverage --coverage.include='packages/experimental/crew/src/host.ts' \
  --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text --coverage.reportsDirectory "$result_root/coverage" \
  --reporter default --reporter json --outputFile "$result_root/unit-results.json" > "$result_root/coverage.log" 2>&1
printf 'LINUX_CREW_HOST_COVERAGE_PASSED\n'
