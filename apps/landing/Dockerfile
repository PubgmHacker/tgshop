# --- deps ---
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/landing/package.json apps/landing/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile --filter @tgshop/landing...

# --- build ---
# FROM deps, not a fresh image: pnpm links every package's own node_modules
# (apps/landing/node_modules/.bin/next included) into the virtual store, and a
# lone COPY of the root node_modules drops those links — `next: not found`.
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @tgshop/landing build

# --- runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/landing/public ./apps/landing/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/.next/static ./apps/landing/.next/static

USER nextjs
# 3200 matches `reverse_proxy landing:3200` in the Caddyfile.
EXPOSE 3200
ENV PORT=3200
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/landing/server.js"]
