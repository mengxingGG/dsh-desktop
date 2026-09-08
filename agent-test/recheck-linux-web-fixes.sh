#!/usr/bin/env bash
# Rebuild the private Web fixture and refresh only reviewed presentation changes.
set -euo pipefail
task_root=/home/admin1/.cache/dsh-crew-web/run-oVU9c9Cd
source_root=/mnt/c/Users/admin/Desktop/workspace/deepseek-harness
checkout_root="$task_root/checkout"
test -d "$checkout_root/.git"
for owner in packages/experimental/webworker-packer packages/experimental/webworker-runtime packages/client/ui-chat packages/client/ui-primitives apps/web/tests; do
  rsync -a --exclude node_modules --exclude lib --exclude dist "$source_root/$owner/" "$checkout_root/$owner/"
done
for manifest in apps/web/package.json pnpm-lock.yaml tsconfig.host.json; do
  cp -- "$source_root/$manifest" "$checkout_root/$manifest"
done
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
export LD_LIBRARY_PATH="$task_root/browser-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
result_root=$(mktemp -d "$task_root/results-XXXXXXXX")
printf 'LINUX_WEB_FIX_RESULTS=%s\n' "$result_root"
cd "$checkout_root"
pnpm install --frozen-lockfile --offline --ignore-scripts > "$result_root/install.log" 2>&1
pnpm run build > "$result_root/build.log" 2>&1
printf 'LINUX_WEB_FIX_BUILD_PASSED\n'
DSH_SNAPSHOT=refresh pnpm exec vitest run --config vitest.web.config.ts \
  apps/web/tests/crew-panel.e2e.ts apps/web/tests/lifecycle-chrome.e2e.ts apps/web/tests/plugin-config.e2e.ts \
  --reporter default --reporter json --outputFile "$result_root/refresh-results.json" \
  > "$result_root/refresh.log" 2>&1
printf 'LINUX_WEB_FIX_REFRESH_PASSED\n'
DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts \
  apps/web/tests/preview-boot.e2e.ts apps/web/tests/remote-welcome.e2e.ts \
  --reporter default --reporter json --outputFile "$result_root/preview-remote-results.json" \
  > "$result_root/preview-remote.log" 2>&1
printf 'LINUX_WEB_PREVIEW_REMOTE_PASSED\n'
