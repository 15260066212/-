#!/bin/bash
RUN_ID="run_1792739797505_zhys95"

echo "=== STEP 1: Wait 20s for first article to start ==="
sleep 20

echo "=== STEP 2: Check status ==="
curl -s "http://localhost:3000/api/pipeline/run/$RUN_ID"
echo ""

echo "=== STEP 3: PAUSE the pipeline ==="
curl -s -X POST "http://localhost:3000/api/pipeline/pause/$RUN_ID"
echo ""

echo "=== STEP 4: Poll 5x while paused (should stay paused) ==="
for i in $(seq 1 5); do
  sleep 3
  STAT=$(curl -s "http://localhost:3000/api/pipeline/run/$RUN_ID" | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)
  COMPLETED=$(curl -s "http://localhost:3000/api/pipeline/run/$RUN_ID" | grep -o '"completedArticles":[0-9]*' | grep -o '[0-9]*')
  echo "  [pause poll $i] status=$STAT completed=$COMPLETED"
done

echo "=== STEP 5: RESUME the pipeline ==="
curl -s -X POST "http://localhost:3000/api/pipeline/resume/$RUN_ID"
echo ""

echo "=== STEP 6: Poll until completion (up to 120s) ==="
for i in $(seq 1 40); do
  sleep 3
  STATUS=$(curl -s "http://localhost:3000/api/pipeline/run/$RUN_ID")
  STAT=$(echo "$STATUS" | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)
  COMPLETED=$(echo "$STATUS" | grep -o '"completedArticles":[0-9]*' | grep -o '[0-9]*')
  TOTAL=$(echo "$STATUS" | grep -o '"totalArticles":[0-9]*' | grep -o '[0-9]*')
  echo "  [resume poll $i] status=$STAT completed=$COMPLETED/$TOTAL"
  echo "$STATUS" | grep -q '"status":"completed"' && echo "=== PIPELINE COMPLETED ===" && break
  echo "$STATUS" | grep -q '"status":"failed"' && echo "=== PIPELINE FAILED ===" && break
done

echo ""
echo "=== FINAL STATUS ==="
curl -s "http://localhost:3000/api/pipeline/run/$RUN_ID"
echo ""
