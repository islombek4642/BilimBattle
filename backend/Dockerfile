# --- Stage 1: Builder ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# --- Stage 2: Final Runtime ---
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# tsconfig.json's rootDir/include (src, scripts, tests) makes tsc mirror the
# full input path under outDir, so compiled output lands at dist/src/... not
# a flat dist/... - every path below must account for that.
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/src/db/schema.sql

# node:20-alpine already ships a non-root "node" user/group (uid/gid 1000)
# for exactly this purpose - creating a new one with the same id collides
# with it and fails the build ("gid '1000' in use").
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]
