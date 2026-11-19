FROM node:24-alpine AS dependencies
LABEL reyunplex.build-cache=true

WORKDIR /app

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
ARG REYUNPLEX_REVISION
RUN REYUNPLEX_REVISION=$REYUNPLEX_REVISION pnpm build && rm -rf .output/server/node_modules/@neteasecloudmusicapienhanced/api/public

FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="YunPlex" \
      org.opencontainers.image.licenses="MIT"

ARG REYUNPLEX_VERSION
ARG REYUNPLEX_REVISION
ARG REYUNPLEX_SOURCE
LABEL org.opencontainers.image.version=$REYUNPLEX_VERSION \
      org.opencontainers.image.revision=$REYUNPLEX_REVISION \
      org.opencontainers.image.source=$REYUNPLEX_SOURCE

WORKDIR /app

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000

COPY --from=build /app/.output ./.output
COPY scripts/maintenance ./maintenance
COPY package.json ./release.json
COPY LICENSE THIRD_PARTY_NOTICES.md ./

# Keep the default data directory writable for the non-root runtime user.
RUN mkdir -p /app/data && chown node:node /app/data

VOLUME ["/app/data"]
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/api/system/health >/dev/null || exit 1

CMD ["node", ".output/server/index.mjs"]
