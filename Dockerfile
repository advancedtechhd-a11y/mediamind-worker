FROM node:20

# Install ffmpeg and Chrome dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxkbcommon0 \
    libxshmfence1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (Puppeteer won't download Chrome due to env var)
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
