/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: require('node:path').resolve(__dirname, '../..'),
  output: 'standalone',
  reactStrictMode: true,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
    ] }]
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' }
    ]
  },
  // The WebView talks only to this app's own domain: /api/* is relayed
  // server-side to the bot (the Caddy-era single-origin layout). The two
  // public domains resolve to different edge IPs and some mobile VPN routes
  // reach one but not the other, so a second client-facing origin is a
  // liability. NEXT_PUBLIC_API_URL must be present at build time — see the
  // ARG in the Dockerfile — because rewrites are serialized into the
  // standalone routes manifest.
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL
    if (!api) return []
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }]
  }
}

module.exports = nextConfig
