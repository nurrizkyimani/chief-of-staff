FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends make poppler-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV OPENCLAW_HOME=/app/.openclaw-home

CMD ["make", "gateway"]
