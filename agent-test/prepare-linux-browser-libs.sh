#!/usr/bin/env bash
# Unpack Chromium's missing distro libraries into the private test directory.
set -euo pipefail
task_root=$(realpath -- "${1:?Pass the prepared Linux Web task directory}")
case "$task_root" in /home/admin1/.cache/dsh-crew-web/run-*) ;; *) exit 1 ;; esac
mkdir -p "$task_root/browser-libs/downloads" "$task_root/browser-libs/root"
cd "$task_root/browser-libs/downloads"
apt-get download libnspr4 libnss3 libasound2t64
for package in ./*.deb; do
  dpkg-deb --extract "$package" "$task_root/browser-libs/root"
done
export LD_LIBRARY_PATH="$task_root/browser-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cd "$task_root/checkout"
"$task_root/runtime/node-v24.14.0-linux-x64/bin/node" --input-type=module -e \
  'import { chromium } from "./apps/web/node_modules/playwright/index.mjs"; const browser = await chromium.launch(); try { console.log("CHROMIUM_READY=" + browser.version()); } finally { await browser.close(); }'
