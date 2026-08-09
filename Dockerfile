# SBC Label Scanner — Next.js UI + Flask API (Docker / Oracle Cloud / any VPS)
# syntax=docker/dockerfile:1
# Builds on amd64 and arm64 (Oracle Ampere A1).

FROM node:20-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV FLASK_ORIGIN=http://127.0.0.1:5000
# Cap heap so low-RAM Oracle free-tier VMs (1 GB) don't thrash during next build
ENV NODE_OPTIONS=--max-old-space-size=768
RUN npm run build

FROM python:3.11-slim-bookworm AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Same bookworm base as the Node build image — avoids nodesource install
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node

COPY requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt

# Flask API (exclude local venvs / dbs via .dockerignore)
COPY server.py setup_db.py requirements.txt /app/api/

# Next standalone
COPY --from=web-build /app/web/public /app/web/public
COPY --from=web-build /app/web/.next/standalone /app/web
COPY --from=web-build /app/web/.next/static /app/web/.next/static

COPY scripts/start.sh /app/start.sh
RUN chmod +x /app/start.sh \
  && mkdir -p /var/data

ENV PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    FLASK_ORIGIN=http://127.0.0.1:5000 \
    DB_PATH=/var/data/users.db \
    HOSTNAME=0.0.0.0 \
    PORT=3000

EXPOSE 3000
CMD ["/app/start.sh"]
