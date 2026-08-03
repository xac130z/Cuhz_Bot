FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./

# better-sqlite3 (the only native module) is an OPTIONAL dependency —
# production uses Postgres. If its install fails on any toolchain issue,
# npm continues and the build still succeeds. No apt-get, no compilers,
# no external package repos: minimal failure surface.
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production

CMD ["node", "src/bot.js"]
