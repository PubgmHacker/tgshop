# syntax=docker/dockerfile:1

# ─── Stage 1: install workspace deps + build all referenced packages ─────────
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/payments/package.json packages/payments/package.json
COPY apps/worker/package.json apps/worker/package.json

RUN pnpm install --frozen-lockfile

COPY packages/db packages/db
COPY packages/core packages/core
COPY packages/payments packages/payments
COPY apps/worker apps/worker
COPY tsconfig.base.json tsconfig.base.json

RUN pnpm --filter @tgshop/db exec prisma generate
RUN pnpm --filter @tgshop/db... --filter @tgshop/worker run build

# ─── Stage 2: production runtime, only prod deps + built dist ────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/payments/package.json packages/payments/package.json
COPY apps/worker/package.json apps/worker/package.json

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /repo/packages/db/dist packages/db/dist
COPY --from=builder /repo/packages/db/prisma packages/db/prisma
# pnpm keeps the generated client inside its virtual store, not at
# node_modules/.prisma — that path only exists under npm's hoisted layout, so
# regenerate the client in this tree instead of copying it across stages.
RUN cd packages/db && ./node_modules/.bin/prisma generate
COPY --from=builder /repo/packages/core/dist packages/core/dist
COPY --from=builder /repo/packages/payments/dist packages/payments/dist
COPY --from=builder /repo/apps/worker/dist apps/worker/dist

RUN addgroup -S tgshop && adduser -S tgshop -G tgshop
USER tgshop

EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/worker/dist/index.js"]
