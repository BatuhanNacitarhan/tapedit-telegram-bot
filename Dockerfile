FROM node:20-slim

RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libatspi2.0-0 \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

RUN npx playwright install chromium --with-deps

COPY . .

# Persistent storage için /data dizini
# Bu dizin Koyeb'de volume olarak mount edilecek
RUN mkdir -p /data /app/downloads

# Environment variable default
ENV DATA_DIR=/data

CMD ["npm", "start"]
