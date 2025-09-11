/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    SITE_URL: process.env.SITE_URL || 'http://localhost:3000',
  }
};

export default nextConfig;