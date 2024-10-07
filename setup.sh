pnpm install
cd themes/shokax
git checkout v0.4.11
node ./toolbox/compiler.mjs
cd ../..
node ./themes/shokax/toolbox/hoistdep.mjs

cd ./node_modules
ln -s ../themes/shokax hexo-theme-shokax

cd ..