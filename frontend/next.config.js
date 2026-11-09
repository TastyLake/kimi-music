/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://backend:3000/api/:path*',
      },
      {
        source: '/auth/:path*',
        destination: 'http://backend:3000/api/auth/:path*',
      },
      {
        source: '/media/:path*',
        destination: 'http://backend:3000/media/:path*',
      }
    ];
  },
};

module.exports = nextConfig;
