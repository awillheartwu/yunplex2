FROM node:24-alpine AS build
LABEL reyunplex.build-cache=true

WORKDIR /app

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && rm -rf .output/server/node_modules/NeteaseCloudMusicApi/public

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000

COPY --from=build /app/.output ./.output
COPY scripts/maintenance ./maintenance
COPY package.json ./release.json

# Keep the default data directory writable for the non-root runtime user.
RUN mkdir -p /app/data && chown node:node /app/data

VOLUME ["/app/data"]
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/api/system/health >/dev/null || exit 1

CMD ["node", ".output/server/index.mjs"]
