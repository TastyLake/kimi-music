FROM node:20-bookworm-slim

# Перенаправляем репозитории на зеркало Яндекса во избежание таймаутов
RUN sed -i 's/deb.debian.org/mirror.yandex.ru/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true && \
    sed -i 's/deb.debian.org/mirror.yandex.ru/g' /etc/apt/sources.list 2>/dev/null || true

# Установка системных пакетов
RUN apt-get update -o Acquire::Check-Valid-Until=false && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копирование манифестов зависимостей и Prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Установка зависимостей и генерация Prisma Client
RUN npm ci
RUN npx prisma generate

# Копирование исходного кода
COPY . .

# Сборка TypeScript проекта
RUN npm run build

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]

