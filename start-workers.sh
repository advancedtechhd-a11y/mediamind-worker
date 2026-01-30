#!/bin/bash

echo "=========================================="
echo "  MEDIAMIND WORKER CLUSTER"
echo "  Starting all 5 services..."
echo "=========================================="

# Start all workers in background
node dist/workers/video-standalone.js &
node dist/workers/image-standalone.js &
node dist/workers/webcontent-standalone.js &
node dist/workers/ffmpeg-standalone.js &

# Start orchestrator in foreground (keeps container running)
node dist/orchestrator.js
