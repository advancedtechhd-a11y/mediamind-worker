#!/bin/sh

echo "=========================================="
echo "  MEDIAMIND WORKER CLUSTER"
echo "  Starting all 5 services..."
echo "=========================================="

# Start all workers in background
node dist/workers/video-standalone.js &
sleep 2
node dist/workers/image-standalone.js &
sleep 2
node dist/workers/webcontent-standalone.js &
sleep 2
node dist/workers/ffmpeg-standalone.js &
sleep 3

echo "All workers started, launching orchestrator..."

# Start orchestrator in foreground (keeps container running)
node dist/orchestrator.js
