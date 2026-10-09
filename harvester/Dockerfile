FROM node:18-bullseye

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

COPY package.json package-lock.json* ./
RUN npm install --production

COPY server.js ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3003 6080

ENTRYPOINT ["./entrypoint.sh"]
