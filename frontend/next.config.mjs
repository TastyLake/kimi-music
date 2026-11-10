/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    proxyTimeout: 300000,
    middlewareClientMaxBodySize: '100mb',
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
      },
      {
        source: '/media/:path*',
        destination: `${backend}/media/:path*`,
      },
    ];
  },
};

export default nextConfig;
