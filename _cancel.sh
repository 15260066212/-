#!/bin/bash
echo "=== Cancelling pipeline ==="
curl -s -X POST http://localhost:3000/api/pipeline/cancel/run_1792739269656_gvmwy7
echo
echo "=== Status after cancel ==="
curl -s http://localhost:3000/api/pipeline/run/run_1792739269656_gvmwy7
echo
