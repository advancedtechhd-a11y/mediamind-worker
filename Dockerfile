FROM node:20-slim

# Install base dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright with all system dependencies (official method)
RUN npx playwright install --with-deps chromium

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
