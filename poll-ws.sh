#!/bin/bash
for i in 1 2 3 4 5 6; do
  sleep 7
  echo "=== tick $i ==="
  ss -tn 2>/dev/null | grep 9527 | head -5
done
echo "=== final ports ==="
ss -tlnp 2>/dev/null | grep 9527
