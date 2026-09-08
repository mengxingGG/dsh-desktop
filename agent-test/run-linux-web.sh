#!/usr/bin/env bash
# Run the original Linux Web lane in an already prepared, private source copy.
set -euo pipefail
task_root=$(realpath -- "${1:?Pass the task directory printed by prepare-linux-web.sh}")
shift
case "$task_root" in /home/admin1/.cache/dsh-crew-web/run-*) ;; *) exit 1 ;; esac
[[ -d "$task_root/checkout/.git" && -d "$task_root/runtime" ]]
export PATH="$task_root/runtime/node-v24.14.0-linux-x64/bin:$task_root/runtime/pnpm/node_modules/.bin:$PATH"
if [[ -d "$task_root/browser-libs/root/usr/lib/x86_64-linux-gnu" ]]; then
  export LD_LIBRARY_PATH="$task_root/browser-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
result_root=$(mktemp -d "$task_root/results-XXXXXXXX")
printf 'LINUX_WEB_RESULTS=%s\n' "$result_root"
cd "$task_root/checkout"
pnpm --filter @deepseek-ai/dsh-web-frontend exec playwright install chromium
if [[ "${1:-}" == --built ]]; then
  shift
else
  pnpm run build 2>&1 | tee "$result_root/build.log"
fi
DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts \
  --reporter default --reporter json --outputFile "$result_root/web-results.json" "$@" \
  2>&1 | tee "$result_root/web.log"
