FROM mcr.microsoft.com/playwright:v1.54.1-noble

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    TZ=Asia/Shanghai \
    NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends imagemagick librsvg2-bin fonts-noto-cjk curl jq file xvfb x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/content
COPY automation/package*.json ./automation/
RUN npm --prefix automation install --omit=dev --no-audit --no-fund
COPY . .

RUN chmod +x tools/*.sh deploy/login-entrypoint.sh deploy/bin/magick \
    && install -m 0755 deploy/bin/magick /usr/local/bin/magick \
    && mkdir -p /data/daily /data/browser-profile /references \
    && chown -R ubuntu:ubuntu /app/content /data

USER ubuntu
ENTRYPOINT ["node", "/app/content/automation/src/cli.js"]
CMD ["run", "--live"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node --check /app/content/automation/src/cli.js || exit 1
