# syntax=docker/dockerfile:1

# ==================== Docker CLI used by the Web runtime manager ====================
FROM docker:27.5.1-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c AS docker-cli

# ==================== Shared glibc/OpenSSL base ====================
FROM node:22-bookworm-slim AS base

# Prisma generation must detect the same OpenSSL ABI used at runtime, while
# Temporal's native bridge requires glibc rather than Alpine/musl.
RUN rm -f /etc/apt/apt.conf.d/docker-clean
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates openssl

# ==================== Stage 1: Dependencies ====================
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# ==================== Local container development ====================
FROM deps AS development

ENV NODE_ENV=development

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends gosu tini

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --chown=root:root docker/development/entrypoint.sh /usr/local/bin/waoowaoo-dev-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/waoowaoo-dev-entrypoint \
    && chmod 0755 /usr/local/bin/waoowaoo-dev-entrypoint

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/waoowaoo-dev-entrypoint"]

# ==================== Stage 2: Build ====================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ==================== Stage 3: Production ====================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends gosu tini

# One immutable image contains both entrypoints, but Compose runs Web and each
# Temporal Worker slot as separate containers. They never share a process or
# failure domain. The Worker is currently executed from TypeScript through tsx.
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json

COPY --chown=node:node --from=builder /app/.next ./.next
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/scripts ./scripts
COPY --chown=node:node --from=builder /app/standards ./standards
COPY --chown=node:node --from=builder /app/messages ./messages
COPY --chown=node:node --from=builder /app/tsconfig.json ./tsconfig.json
COPY --chown=node:node --from=builder /app/tsconfig.runtime-scripts.json ./tsconfig.runtime-scripts.json
COPY --chown=node:node --from=builder /app/next.config.ts ./next.config.ts
COPY --chown=node:node --from=builder /app/src/middleware.ts ./src/middleware.ts
COPY --chown=node:node --from=builder /app/postcss.config.mjs ./postcss.config.mjs

# The Web process starts one short-lived, restricted Codex container only while
# a project is active. The Docker daemon remains a host concern; this image only
# carries the client used by the Runtime Session Manager.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

RUN mkdir -p /app/data /app/logs \
    && touch /app/.env \
    && chown -R node:node /app/data /app/logs /app/.env

COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/waoowaoo-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/waoowaoo-entrypoint \
    && chmod 0755 /usr/local/bin/waoowaoo-entrypoint

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/waoowaoo-entrypoint"]
CMD ["npm", "run", "start:next"]
