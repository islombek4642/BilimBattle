# --- Stage 1: Builder ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: Final Runtime ---
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Non-root user
RUN addgroup -g 1000 appuser && adduser -u 1000 -G appuser -s /bin/sh -D appuser

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# tsconfig.json's rootDir/include (src, scripts, tests) makes tsc mirror the
# full input path under outDir, so compiled output lands at dist/src/... not
# a flat dist/... - every path below must account for that.
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/src/db/schema.sql

RUN chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]
