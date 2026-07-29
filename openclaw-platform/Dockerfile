FROM ghcr.io/openclaw/gogcli:v0.19.0 AS gogcli

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends make poppler-utils ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY --from=gogcli /usr/local/bin/gog /usr/local/bin/gog

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV OPENCLAW_HOME=/app/.openclaw-home

CMD ["make", "gateway"]
