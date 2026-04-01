#!/bin/bash
echo "Starting Cache Hunter Proxy..."
npm start &
PROXY_PID=$!
sleep 2

echo "Running test requests..."

# Get model name from vLLM
MODEL=$(curl -s http://localhost:8787/v1/models | jq -r '.data[0].id' 2>/dev/null || echo "")

if [ -z "$MODEL" ]; then
  echo "⚠️  Could not get model from vLLM, using placeholder"
  MODEL="test"
fi

echo "Using model: $MODEL"

# Test 1: Simple completion
echo -e "\n1. Testing chat completion..."
curl -s http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Say hi in one word\"}]
  }" | jq -r '.choices[0].message.content // .error.message' 2>/dev/null

# Test 2: Longer prompt
echo -e "\n2. Testing longer prompt..."
curl -s http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"You are helpful\"},
      {\"role\": \"user\", \"content\": \"Count from 1 to 5\"}
    ]
  }" | jq -r '.choices[0].message.content // .error.message' 2>/dev/null

sleep 1

echo -e "\n3. Logged requests:"
sqlite3 -header -column cache-hunter.db "
  SELECT 
    datetime(r.timestamp/1000, 'unixepoch', 'localtime') as time,
    r.path,
    resp.status_code,
    resp.duration_ms,
    resp.prompt_tokens,
    resp.completion_tokens,
    resp.total_tokens
  FROM requests r
  JOIN responses resp ON r.id = resp.request_id
  ORDER BY r.timestamp DESC
  LIMIT 5;"

echo -e "\n4. Request bodies (for prefix analysis):"
sqlite3 cache-hunter.db "SELECT substr(body, 1, 150) as preview FROM requests WHERE path='/v1/chat/completions' ORDER BY timestamp DESC LIMIT 3;"

kill $PROXY_PID 2>/dev/null || true
echo -e "\n✅ Test complete!"
