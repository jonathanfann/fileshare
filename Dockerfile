FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public
COPY scripts/stamp-build.js ./scripts/stamp-build.js

ENV PORT=3000
ENV SHARE_DIR=/data/files
ENV DB_PATH=/data/db/fileshare.db
ENV DOCKER=1

EXPOSE 3000

VOLUME ["/data/files", "/data/db"]

CMD ["sh", "-c", "node scripts/stamp-build.js && node server.js"]
