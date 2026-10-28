#!/usr/bin/env python3
import re, shutil

path = "/usr/lib/node_modules/@wechatsync/cli/dist/index.js"
token = "9251ae04-5fc5-4549-badb-2f0fc8106571"

with open(path) as f:
    content = f.read()

# Backup
shutil.copy2(path, path + ".bak2")

# Replace the token line
old = 'token = process.env.WECHATSYNC_TOKEN || process.env.MCP_TOKEN || "";'
new = f'token = "{token}"; // patched hardcoded'

if old in content:
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    print("PATCHED successfully")
else:
    print("PATTERN NOT FOUND!")
    # show nearby lines
    for i, line in enumerate(content.split('\n'), 1):
        if 'WECHATSYNC_TOKEN' in line or 'MCP_TOKEN' in line or 'this.token' in line:
            print(f"  L{i}: {line.strip()}")
