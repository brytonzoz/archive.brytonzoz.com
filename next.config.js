/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    domains: ['justaremindertolivelife.com', 'nonparallel.wixstudio.com', 'scrapwrk.com'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-c4515a0205d64d9e849dcafe9141149b.r2.dev',
      },
    ],
    unoptimized: true
  },
}

module.exports = nextConfig
