# --- deps ---
FROM node:20-alpine AS deps
WORKDIR /app
# openssl keeps prisma's engine-target detection consistent for the generate
# that runs during the dependency builds (@tgshop/db is here via @tgshop/core).
RUN apk add --no-cache openssl && corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/admin-miniapp/package.json apps/admin-miniapp/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/payments/package.json packages/payments/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile --filter @tgshop/admin-miniapp...

# --- build ---
# FROM deps, not a fresh image: pnpm links every package's own node_modules
# (apps/admin-miniapp/node_modules/.bin/next included) into the virtual store,
# and a lone COPY of the root node_modules drops those links — `next: not found`.
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined into the client bundle at build time, so they must
# arrive as build args (docker-compose passes them under admin-miniapp.build.args).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# `--filter @tgshop/admin-miniapp...` builds @tgshop/db (prisma generate + tsc)
# and @tgshop/core first — format.ts imports @tgshop/core/money from dist,
# which .dockerignore strips from the build context.
RUN pnpm --filter @tgshop/admin-miniapp... build

# --- runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/admin-miniapp/public ./apps/admin-miniapp/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin-miniapp/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin-miniapp/.next/static ./apps/admin-miniapp/.next/static

USER nextjs
# 3500 matches `reverse_proxy admin-miniapp:3500` in the Caddyfile.
EXPOSE 3500
ENV PORT=3500
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/admin-miniapp/server.js"]
