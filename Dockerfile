FROM node:20

# Install ffmpeg and basic deps
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set browser path so it persists
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright system dependencies first
RUN npx playwright install-deps chromium

# Install browser to specific path and verify
RUN npx playwright install chromium && \
    echo "Browser installed to:" && \
    ls -la /app/.playwright-browsers/ && \
    find /app/.playwright-browsers -name "chrome*" -type f

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Expose all service ports
EXPOSE 3000 3001 3002 3003 3004

# Start all workers using a startup script
COPY start-workers.sh ./
RUN chmod +x start-workers.sh
CMD ["./start-workers.sh"]
