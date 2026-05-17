FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/env/package.json packages/env/
COPY packages/config/package.json packages/config/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim AS server
WORKDIR /app
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/server/package.json ./
COPY --from=builder /app/package.json ./
ENV NODE_ENV=production
EXPOSE 3002
CMD ["bun", "run", "dist/index.mjs"]

FROM oven/bun:1 AS web-builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/env/package.json packages/env/
COPY packages/config/package.json packages/config/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build --filter=web

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
