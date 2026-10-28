#!/bin/bash
FILE=/home/ubuntu/wechatsync-ext/assets/index.ts-Bw-475TG.js
echo "=== token error context ==="
grep -oP '.{0,200}Invalid or missing token.{0,200}' $FILE
echo ""
echo "=== token var assignments ==="
grep -oP '.{0,100}this\.token.{0,100}' $FILE | head -10
echo ""
echo "=== bridge/WS server url ==="
grep -oP '.{0,100}localhost.{0,100}' $FILE | grep -iE '9527|9528|ws://|bridge' | head -10
echo ""
echo "=== token comparison ==="
grep -oP '.{0,150}token.{0,300}' $FILE | grep -iE '===|==|verify|check|valid|compare' | head -10
