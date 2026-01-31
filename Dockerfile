FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Skip browser download - use pre-installed browsers from image
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies
RUN npm install

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
