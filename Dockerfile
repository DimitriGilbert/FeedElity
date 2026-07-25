FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY apps/desktop/package.json apps/desktop/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/env/package.json packages/env/
COPY packages/config/package.json packages/config/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build --filter=server...

FROM oven/bun:1-slim AS server
WORKDIR /app
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/server/package.json ./
COPY --from=builder /app/package.json ./
COPY docker/server-entrypoint.sh ./server-entrypoint.sh
COPY docker/server-healthcheck.mjs ./server-healthcheck.mjs
ENV NODE_ENV=production
EXPOSE 3002
CMD ["./server-entrypoint.sh"]

FROM oven/bun:1 AS web-builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY apps/desktop/package.json apps/desktop/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/env/package.json packages/env/
COPY packages/config/package.json packages/config/
RUN bun install --frozen-lockfile
COPY . .
# Build the SPA same-origin: the web client falls back to the page's own origin
# when VITE_SERVER_URL is unset, so nginx can reverse-proxy from any host. Strip
# the dev .env so a host-specific VITE_SERVER_URL is never baked into the bundle.
RUN rm -f apps/web/.env apps/web/.env.local
RUN bun run build --filter=web

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
