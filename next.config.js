/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    // Images are pre-optimized by scripts/build-media.mjs; there is no image server in a static export.
    unoptimized: true
  },
}

module.exports = nextConfig
