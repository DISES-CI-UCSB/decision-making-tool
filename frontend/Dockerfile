# Build context is the repository root so `build:vercel` can sync
# `data/solutions` and `data/boundaries`. Vercel still uses `frontend/` only.
FROM node:22-bookworm-slim AS build

WORKDIR /src
ENV HUSKY=0 \
    ENABLE_MANIFEST_EDITOR=false \
    METRICS_API_BASE_URL=/metrics-api \
    NODE_OPTIONS=--max-old-space-size=4096

ARG FIREBASE_API_KEY
ARG FIREBASE_AUTH_DOMAIN
ARG FIREBASE_PROJECT_ID
ARG FIREBASE_STORAGE_BUCKET
ARG FIREBASE_MESSAGING_SENDER_ID
ARG FIREBASE_APP_ID
ARG FIREBASE_MEASUREMENT_ID
ARG ACCESS_REQUEST_NOTIFICATION_EMAIL
ARG GOOGLE_CLIENT_ID
ARG MANIFEST_BLOB_URL
ARG CATALOG_RELEASE_INDEX_BLOB_URL
ARG SIRAP_MANIFEST_BLOB_URL
ARG BLOB_ASSET_PROXY_PATH
ARG METRICS_API_BASE_URL=/metrics-api
ARG ENABLE_MANIFEST_EDITOR=false

ENV FIREBASE_API_KEY=$FIREBASE_API_KEY \
    FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN \
    FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID \
    FIREBASE_STORAGE_BUCKET=$FIREBASE_STORAGE_BUCKET \
    FIREBASE_MESSAGING_SENDER_ID=$FIREBASE_MESSAGING_SENDER_ID \
    FIREBASE_APP_ID=$FIREBASE_APP_ID \
    FIREBASE_MEASUREMENT_ID=$FIREBASE_MEASUREMENT_ID \
    ACCESS_REQUEST_NOTIFICATION_EMAIL=$ACCESS_REQUEST_NOTIFICATION_EMAIL \
    GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID \
    MANIFEST_BLOB_URL=$MANIFEST_BLOB_URL \
    CATALOG_RELEASE_INDEX_BLOB_URL=$CATALOG_RELEASE_INDEX_BLOB_URL \
    SIRAP_MANIFEST_BLOB_URL=$SIRAP_MANIFEST_BLOB_URL \
    BLOB_ASSET_PROXY_PATH=$BLOB_ASSET_PROXY_PATH \
    METRICS_API_BASE_URL=$METRICS_API_BASE_URL \
    ENABLE_MANIFEST_EDITOR=$ENABLE_MANIFEST_EDITOR

COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci

COPY frontend/ frontend/
COPY data/solutions/nacional/ data/solutions/nacional/
COPY data/boundaries/sirap_regions.geojson data/boundaries/sirap_regions.geojson

WORKDIR /src/frontend
RUN npm run build:vercel \
    && test -f dist/eco-plan/browser/index.html

FROM nginx:1.27-alpine AS runtime

COPY frontend/docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/frontend/dist/eco-plan/browser /usr/share/nginx/html

RUN sed -i '/^user /d' /etc/nginx/nginx.conf \
    && mkdir -p /var/cache/nginx /var/run \
    && touch /var/run/nginx.pid \
    && chown -R nginx:nginx \
        /etc/nginx/conf.d \
        /etc/nginx/templates \
        /var/cache/nginx \
        /var/run \
        /var/log/nginx \
        /usr/share/nginx/html \
        /var/run/nginx.pid

ENV METRICS_API_UPSTREAM=http://backend:8000 \
    NGINX_ENVSUBST_FILTER=METRICS_API_UPSTREAM

EXPOSE 8080
USER nginx

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/health || exit 1
