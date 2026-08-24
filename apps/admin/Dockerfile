# --- deps ---
FROM node:20-alpine AS deps
WORKDIR /app
# openssl keeps prisma's engine-target detection consistent between install,
# generate and runtime — @tgshop/db is a direct dependency here.
RUN apk add --no-cache openssl && corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/payments/package.json packages/payments/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile --filter @tgshop/admin...

# --- build ---
# FROM deps, not a fresh image: pnpm links every package's own node_modules
# (apps/admin/node_modules/.bin/next included) into the virtual store, and a
# lone COPY of the root node_modules drops those links — `next: not found`.
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The admin's server actions import { prisma } from @tgshop/db and use its enums
# as runtime values, so the whole dependency chain has to be built before the
# Next build: `--filter @tgshop/admin...` builds @tgshop/db (prisma generate +
# tsc) and @tgshop/core first, then compiles the admin app.
RUN pnpm --filter @tgshop/admin... build

# --- runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
# Server actions run the prisma query engine inside this image — detection has
# to agree with the builder that generated it.
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static

USER nextjs
# 3300 matches `reverse_proxy admin:3300` in the Caddyfile.
EXPOSE 3300
ENV PORT=3300
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/admin/server.js"]
