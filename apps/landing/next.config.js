/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: require('node:path').resolve(__dirname, '../..'),
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  trailingSlash: true,
};

module.exports = nextConfig;
