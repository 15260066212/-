# === Stage 1: Monorepo dependency install ===
FROM node:22-bullseye AS deps

WORKDIR /app

# Copy root workspace config
COPY package.json package-lock.json* ./
COPY .npmrc ./

# Copy all workspace package.json files for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY packages/account-vault/package.json packages/account-vault/
COPY apps/harvester/package.json apps/harvester/

# Install production dependencies only
RUN npm install --production --legacy-peer-deps || npm install --production

# === Stage 2: Build shared packages ===
FROM node:22-bullseye AS builder

WORKDIR /app

# Copy all deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps

# Copy source for shared packages that need building
COPY packages/shared/ packages/shared/
COPY packages/account-vault/ packages/account-vault/

# Copy tsconfig base
COPY tsconfig.base.json ./

# Build shared packages (TypeScript → JS)
RUN cd packages/shared && npx tsc --outDir dist || true
RUN cd packages/account-vault && npx tsc --outDir dist || true

# === Stage 3: Runtime (Playwright + noVNC) ===
FROM node:22-bullseye

# Install Playwright system dependencies + Xvfb + VNC + noVNC
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    fluxbox \
    websockify \
    novnc \
    net-tools \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-browsers
RUN npx playwright@1.40.0 install chromium --with-deps

WORKDIR /app

# Copy node_modules and built packages from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Copy harvester source
COPY apps/harvester/src ./src
COPY apps/harvester/entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Environment
ENV NODE_ENV=production
ENV PORT=3003
ENV NOVNC_BASE_URL=/novnc

EXPOSE 3003 6080

ENTRYPOINT ["./entrypoint.sh"]
