/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb'
    }
  },
  transpilePackages: ['@tgshop/db', '@tgshop/core']
}

export default nextConfig
