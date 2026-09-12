import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  reactStrictMode: true,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
    ] }]
  },
  webpack(config) {
    // BullMQ exposes an optional Valkey backend from its barrel export. The
    // admin uses ioredis, so make that optional branch explicit to Next's
    // bundler instead of emitting a misleading missing-module warning.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@valkey/valkey-glide': false
    }
    return config
  },
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb'
    }
  },
    // Prisma's query engine is a .node binary that @prisma/client resolves by
    // path at runtime rather than through require(), so Next's output tracing
    // cannot see it: `output: 'standalone'` produced a bundle that booted fine
    // and then threw PrismaClientInitializationError on the first query. Every
    // page here reads the database, so that image was dead on arrival.
    //
    // The whole generated client is copied, not just the engine: the engine
    // filename is platform-specific (libquery_engine-darwin-arm64.dylib.node
    // locally, linux-musl-openssl-3.0.x in the Alpine image, since `prisma
    // generate` runs in the build stage), and schema.prisma sits beside it.
    // The version glob avoids re-pinning this on every Prisma bump.
    //
    // Traced files keep their path relative to the tracing root, so this lands
    // at standalone/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/
    // client — the first location Prisma's loader searches, per the error's own
    // "following locations have been searched" list.
  outputFileTracingIncludes: {
      '**/*': ['../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*']
  },
  transpilePackages: ['@tgshop/db', '@tgshop/core']
}

export default nextConfig
