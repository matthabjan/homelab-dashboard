# node:24-alpine, pinned by digest so rebuilds are reproducible. To update:
#   docker buildx imagetools inspect node:24-alpine   → copy the Digest line
ARG NODE_IMAGE=node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

# ---- build ----
# The bundle is plain JS (the TypeScript is compiled away), so it is built once on the build machine's own platform,
# not again under emulation for every target platform.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- production dependencies, installed for the target platform ----
# so that a native module would get its binary for that platform, not the build machine's
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM ${NODE_IMAGE}
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    PORT=3000 \
    CONFIG_DIR=/config \
    DEMO_CONFIG_DIR=/app/config.example \
    DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# starter config, used when no /config volume is mounted and copied out by the README's quick start;
# the full demo config is what DEMO=1 shows (DEMO_CONFIG_DIR)
COPY config.starter /config
COPY config.example /app/config.example
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "build"]
