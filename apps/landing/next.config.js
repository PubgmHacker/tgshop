/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: require('node:path').resolve(__dirname, '../..'),
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
    ] }]
  },
  trailingSlash: true,
};

module.exports = nextConfig;
