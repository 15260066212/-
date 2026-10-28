#!/bin/bash
set +e
echo "=== starting CLI, waiting for extension ==="
timeout 60 wechatsync ls 2>&1
echo "=== exit: $? ==="
