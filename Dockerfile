FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 is a native module. On glibc it usually installs a prebuilt
# binary, but if none matches it compiles from source — these are the tools it
# needs. (node:18-alpine had none of them, which broke the build.)
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --omit=dev

# .dockerignore keeps the repo's stale node_modules from clobbering the
# freshly installed one on this COPY.
COPY . .

ENV NODE_ENV=production

CMD ["node", "src/bot.js"]
