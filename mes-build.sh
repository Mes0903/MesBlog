#!/bin/bash

cd vuepress-theme-hope
./mes-build.sh
cd ..
rm pnpm-lock.yaml
pnpm install
pnpm run dev:vite-clean