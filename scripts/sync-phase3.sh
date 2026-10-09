#!/bin/bash
cd /app

for pkg in shared scraper dialogue-engine publisher manual-generator ai-engine content-generator content-reviewer; do
  if [ -d "packages/$pkg/dist" ] && [ -d "node_modules/@zemingengine/$pkg/dist" ]; then
    cp -r "packages/$pkg/dist/"* "node_modules/@zemingengine/$pkg/dist/"
    echo "synced $pkg"
  fi
done

echo "All dist directories synced"
