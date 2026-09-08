#!/usr/bin/env bash
# Rebuild the changed Web owners and replay every original Web scenario without refreshing goldens.
set -euo pipefail
task_root=/home/admin1/.cache/dsh-crew-web/run-oVU9c9Cd
source_root=/mnt/c/Users/admin/Desktop/workspace/deepseek-harness
checkout_root="$task_root/checkout"
test -d "$checkout_root/.git"
for owner in packages/experimental/webworker-packer packages/experimental/webworker-runtime packages/client/ui-chat packages/client/ui-primitives apps/web/tests; do
  rsync -a --exclude node_modules --exclude lib --exclude dist "$source_root/$owner/" "$checkout_root/$owner/"
done
for changed in apps/web/package.json pnpm-lock.yaml tsconfig.host.json packages/extensions/tool-cordis/src/api-catalog.ts; do
  cp -- "$source_root/$changed" "$checkout_root/$changed"
done
for scenario in connection-error hero plan-active; do
  cp -- "$source_root/snapshots/web/lifecycle-chrome/$scenario.expected.md" "$checkout_root/snapshots/web/lifecycle-chrome/$scenario.expected.md"
done
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
export LD_LIBRARY_PATH="$task_root/browser-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
result_root=$(mktemp -d "$task_root/results-XXXXXXXX")
printf 'LINUX_WEB_FINAL_RESULTS=%s\n' "$result_root"
cd "$checkout_root"
pnpm run build > "$result_root/build.log" 2>&1
printf 'LINUX_WEB_FINAL_BUILD_PASSED\n'
DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts \
  --reporter default --reporter json --outputFile "$result_root/web-results.json" \
  > "$result_root/web.log" 2>&1
printf 'LINUX_WEB_FINAL_REPLAY_PASSED\n'
