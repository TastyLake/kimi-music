/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Увеличиваем таймаут ожидания ответа от бэкенда до 5 минут (300 000 мс)
    proxyTimeout: 300000,
    // Снимаем стандартное ограничение Next.js в 10 МБ на размер загружаемого файла
    middlewareClientMaxBodySize: '100mb',
  },
  // Проксирование всех /api запросов напрямую на бэкенд Express
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:4000/api/:path*',
      },
    ];
  },
};

export default nextConfig;