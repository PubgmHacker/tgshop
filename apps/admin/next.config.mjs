/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb'
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
    }
  },
  transpilePackages: ['@tgshop/db', '@tgshop/core']
}

export default nextConfig
