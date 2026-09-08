#!/usr/bin/env bash
# Exercise real filesystem aliases and Crew policy in the private Linux test checkout.
set -euo pipefail
task_root=/home/admin1/.cache/dsh-crew-web/run-oVU9c9Cd
source_root=/mnt/c/Users/admin/Desktop/workspace/deepseek-harness
checkout_root="$task_root/checkout"
test -d "$checkout_root/.git"
for owner in packages/fs/fs packages/fs/fs-local packages/experimental/crew packages/experimental/tool-crew; do
  rsync -a --exclude node_modules --exclude lib --exclude dist "$source_root/$owner/" "$checkout_root/$owner/"
done
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
result_root=$(mktemp -d "$task_root/crew-files-XXXXXXXX")
printf 'LINUX_CREW_FILE_RESULTS=%s\n' "$result_root"
cd "$checkout_root"
pnpm exec vitest run packages/fs/fs/tests packages/fs/fs-local/tests packages/e2b/fs-e2b/tests \
  packages/experimental/crew/tests packages/experimental/tool-crew/tests \
  --reporter default --reporter json --outputFile "$result_root/unit-results.json" > "$result_root/unit.log" 2>&1
printf 'LINUX_CREW_FILES_PASSED\n'
