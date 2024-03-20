#!/bin/sh

rm -rf node_modulesi
npm cache clean --force
npm config set https-proxy null
npm config set proxy null
npm config set registry https://registry.npm.taobao.org
