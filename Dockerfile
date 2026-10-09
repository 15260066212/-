# === Stage 1: Build ===
FROM node:22-bullseye AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY turbo.json ./
COPY .npmrc ./

# Copy all package.json files for workspace resolution
COPY packages/shared/package.json packages/shared/
COPY packages/ai-engine/package.json packages/ai-engine/
COPY packages/account-vault/package.json packages/account-vault/
COPY packages/content-generator/package.json packages/content-generator/
COPY packages/content-reviewer/package.json packages/content-reviewer/
COPY packages/dialogue-engine/package.json packages/dialogue-engine/
COPY packages/manual-generator/package.json packages/manual-generator/
COPY packages/publisher/package.json packages/publisher/
COPY packages/scraper/package.json packages/scraper/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# Install dependencies (includes devDependencies for building)
RUN npm install

# Copy source code
COPY packages/ packages/
COPY apps/ apps/

# Build all packages and apps in correct dependency order using turbo
RUN npx turbo build

# Prune devDependencies - keeps compiled native modules (better-sqlite3)
RUN npm prune --production

# === Stage 2: Production ===
FROM node:22-bullseye-slim

WORKDIR /app

# Copy package files (needed for workspace resolution at runtime)
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY turbo.json ./
COPY .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/ai-engine/package.json packages/ai-engine/
COPY packages/account-vault/package.json packages/account-vault/
COPY packages/content-generator/package.json packages/content-generator/
COPY packages/content-reviewer/package.json packages/content-reviewer/
COPY packages/dialogue-engine/package.json packages/dialogue-engine/
COPY packages/manual-generator/package.json packages/manual-generator/
COPY packages/publisher/package.json packages/publisher/
COPY packages/scraper/package.json packages/scraper/
COPY apps/server/package.json apps/server/

# Copy production node_modules from builder (already has compiled native modules)
COPY --from=builder /app/node_modules ./node_modules

# Copy all built artifacts
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/ai-engine/dist packages/ai-engine/dist
COPY --from=builder /app/packages/account-vault/src packages/account-vault/src
COPY --from=builder /app/packages/content-generator/dist packages/content-generator/dist
COPY --from=builder /app/packages/content-reviewer/dist packages/content-reviewer/dist
COPY --from=builder /app/packages/dialogue-engine/dist packages/dialogue-engine/dist
COPY --from=builder /app/packages/manual-generator/dist packages/manual-generator/dist
COPY --from=builder /app/packages/publisher/dist packages/publisher/dist
COPY --from=builder /app/packages/scraper/dist packages/scraper/dist
COPY --from=builder /app/apps/server/dist apps/server/dist
COPY --from=builder /app/apps/web/dist apps/web/dist

# Copy shared source for file: references
COPY packages/shared/src packages/shared/src

# Create data directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/geo-assistant.db

EXPOSE 3000

# Start server
CMD ["node", "apps/server/dist/index.js"]
