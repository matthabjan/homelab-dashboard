# node:24-alpine, pinned by digest so rebuilds are reproducible. To update:
#   docker buildx imagetools inspect node:24-alpine   → copy the Digest line
ARG NODE_IMAGE=node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

# ---- build ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM ${NODE_IMAGE}
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    PORT=3000 \
    CONFIG_DIR=/config \
    DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
# example config, used when no /config volume is mounted
COPY config.example /config
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "build"]
