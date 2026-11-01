# Targets: ci (base toolchain), dev (devcontainer + the-intern dev image; Playwright noble image, same as CI visual), build, server (default, deployed to Fly).
FROM docker.io/ubuntu:22.04 AS ci
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 git curl wget ca-certificates openssh-client dumb-init sudo xz-utils jq \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/bash dev \
    && usermod --append --groups sudo dev \
    && echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
ARG NODE_VERSION=22.13.1
RUN ARCH="$(uname -m)"; case "$ARCH" in x86_64) A=x64 ;; aarch64|arm64) A=arm64 ;; *) exit 1 ;; esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${A}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 --no-same-owner
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Same image as the CI `visual` job, so screenshots rendered in the devcontainer (and by the-intern agents) match CI baselines.
# Keep the tag in step with @playwright/test and ci.yml / update-snapshots.yml.
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS dev
ARG DEBIAN_FRONTEND=noninteractive
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 git curl wget ca-certificates openssh-client dumb-init sudo xz-utils jq gh \
    && rm -rf /var/lib/apt/lists/*
# The base image ships a uid-1000 `ubuntu` user; replace it so `dev` gets uid 1000 like the other dev images.
RUN (userdel -r ubuntu 2>/dev/null || true) \
    && useradd --create-home --shell /bin/bash --uid 1000 dev \
    && usermod --append --groups sudo dev \
    && echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /__w /github/workspace && chmod -R 777 /__w /github 2>/dev/null || true
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
USER dev
WORKDIR /home/dev

FROM docker.io/node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY templates ./templates
COPY protocol ./protocol
RUN npm ci
RUN npx tsc -b packages/core packages/server && npm run build -w @specage/web
RUN npm prune --omit=dev

FROM docker.io/node:22-bookworm-slim AS server
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/specage.db
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/core/package.json ./packages/core/package.json
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/packages/server/package.json ./packages/server/package.json
COPY --from=build --chown=node:node /app/packages/server/dist ./packages/server/dist
COPY --from=build --chown=node:node /app/packages/web/dist ./packages/web/dist
COPY --from=build --chown=node:node /app/templates ./templates
COPY --from=build --chown=node:node /app/protocol ./protocol
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/packages/server
EXPOSE 8080
CMD ["node", "dist/index.js"]
