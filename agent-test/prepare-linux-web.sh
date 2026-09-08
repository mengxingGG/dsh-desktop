#!/usr/bin/env bash
# Create an isolated source snapshot for the repository's Linux Web test lane.
set -euo pipefail
source_root=/mnt/c/Users/admin/Desktop/workspace/deepseek-harness
task_parent=/home/admin1/.cache/dsh-crew-web
mkdir -p "$task_parent"
task_root=$(mktemp -d "$task_parent/run-XXXXXXXX")
runtime_root="$task_root/runtime"
checkout_root="$task_root/checkout"
mkdir -p "$runtime_root" "$checkout_root"
printf 'LINUX_WEB_TASK=%s\n' "$task_root"

node_version=v24.14.0
archive="node-$node_version-linux-x64.tar.xz"
curl --fail --silent --show-error --location --max-time 180 \
  "https://nodejs.org/dist/$node_version/$archive" -o "$runtime_root/$archive"
curl --fail --silent --show-error --location --max-time 60 \
  "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$runtime_root/SHASUMS256.txt"
(
  cd "$runtime_root"
  grep "  $archive\$" SHASUMS256.txt | sha256sum --check --strict
  tar -xf "$archive"
)
export PATH="$runtime_root/node-$node_version-linux-x64/bin:$PATH"
npm install --prefix "$runtime_root/pnpm" --ignore-scripts --no-audit --no-fund pnpm@11.7.0
export PATH="$runtime_root/pnpm/node_modules/.bin:$PATH"
command -v make >/dev/null
command -v g++ >/dev/null

rsync -a \
  --exclude .git --exclude node_modules --exclude lib --exclude dist \
  --exclude agent-test --exclude '.env*' --exclude '.pytest*' --exclude coverage \
  --exclude '.cache' --exclude '.generated' --exclude '.dist' \
  --exclude '/DeepSeek-Harness.exe' --exclude '/.pnpm-store' \
  "$source_root/" "$checkout_root/"

# Git-for-Windows may check symbolic links out as their literal link targets.
# Restore only Git-recorded symlinks inside this newly allocated snapshot.
git -c "safe.directory=$source_root" -C "$source_root" ls-files --stage -z |
while IFS= read -r -d '' entry; do
  [[ "$entry" == '120000 '* ]] || continue
  relative_path=${entry#*$'\t'}
  copied_path="$checkout_root/$relative_path"
  [[ -f "$copied_path" && ! -L "$copied_path" ]] || continue
  resolved_parent=$(realpath -m "$(dirname "$copied_path")")
  case "$resolved_parent/" in "$checkout_root/"*) ;; *) exit 1 ;; esac
  link_target=$(<"$copied_path")
  rm -- "$copied_path"
  ln -s -- "$link_target" "$copied_path"
done

cd "$checkout_root"
git init -q -b main
git add --all
git -c user.name='Crew Web fixture' -c user.email='crew-web@example.invalid' \
  -c core.hooksPath=/dev/null commit -q -m 'Isolated current-source Web fixture'
pnpm install --frozen-lockfile
pnpm --filter @deepseek-ai/dsh-web-frontend exec playwright install chromium
node --input-type=module -e 'import { createRequire } from "node:module"; createRequire(new URL("./packages/session/session-persistence-jsonl/package.json", import.meta.url))("fs-ext"); console.log("SESSION_LOCK_ADDON_READY")'
printf 'LINUX_WEB_READY=%s\n' "$checkout_root"
if [[ "${1:-}" == --run ]]; then
  bash "$source_root/agent-test/prepare-linux-browser-libs.sh" "$task_root"
  bash "$source_root/agent-test/run-linux-web.sh" "$task_root"
fi
