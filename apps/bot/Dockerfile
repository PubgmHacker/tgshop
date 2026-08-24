# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
# openssl: without it prisma cannot detect the libssl version and falls back to
# the openssl-1.1.x engine target — a different binary name than the engines
# actually fetched at install time, so the runtime would try to re-download.
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ---- deps: install full workspace deps with lockfile ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/payments/package.json packages/payments/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/bot/package.json apps/bot/package.json
RUN pnpm install --frozen-lockfile --filter @tgshop/bot... || pnpm install --filter @tgshop/bot...

# ---- build: compile workspace deps then this app ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY packages/core packages/core
COPY packages/payments packages/payments
COPY packages/ui packages/ui
COPY apps/bot apps/bot
RUN pnpm --filter @tgshop/db exec prisma generate
RUN pnpm --filter @tgshop/core... --filter @tgshop/bot... build

# ---- runtime: production-only node_modules ----
FROM base AS deps-prod
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/payments/package.json packages/payments/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/bot/package.json apps/bot/package.json
RUN pnpm install --frozen-lockfile --prod --filter @tgshop/bot... || pnpm install --prod --filter @tgshop/bot...
# The runtime copies THIS node_modules tree, but postinstall here saw no schema,
# so @prisma/client is still the throwing stub — generate the real client in
# place. `migrate diff` then forces the schema-engine download while we are
# still root: `migrate deploy` at boot runs as an unprivileged user and must
# never need to write into node_modules.
COPY packages/db/prisma packages/db/prisma
RUN cd packages/db \
 && ./node_modules/.bin/prisma generate \
 && ./node_modules/.bin/prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /dev/null

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache dumb-init openssl
WORKDIR /repo
COPY --from=deps-prod /repo/node_modules ./node_modules
COPY --from=deps-prod /repo/packages ./packages
COPY --from=deps-prod /repo/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/db/prisma ./packages/db/prisma
COPY --from=build /repo/packages/core/dist ./packages/core/dist
COPY --from=build /repo/packages/payments/dist ./packages/payments/dist
COPY --from=build /repo/apps/bot/dist ./apps/bot/dist
COPY --from=build /repo/apps/bot/package.json ./apps/bot/package.json

WORKDIR /repo/apps/bot
RUN addgroup -S tgshop && adduser -S tgshop -G tgshop
USER tgshop
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
# Apply pending Prisma migrations before boot: `prisma` is a prod dependency of
# @tgshop/db precisely so the CLI is present in this --prod node_modules tree.
# `migrate deploy` is idempotent and a no-op when the schema is current.
CMD ["sh", "-c", "(cd ../../packages/db && ./node_modules/.bin/prisma migrate deploy) && exec node dist/index.js"]
