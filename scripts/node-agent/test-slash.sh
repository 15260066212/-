#!/bin/bash
echo "=== /api/credentials (no trailing slash) ==="
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:3000/api/credentials

echo ""
echo "=== /api/credentials/ (with trailing slash) ==="
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:3000/api/credentials/

echo ""
echo "=== /api/articles (no trailing slash) ==="
curl -s -o /dev/null -w "HTTP:%{http_code}\n" http://localhost:3000/api/articles

echo ""
echo "=== /api/articles/ (with trailing slash) ==="
curl -s -o /dev/null -w "HTTP:%{http_code}\n" http://localhost:3000/api/articles/
