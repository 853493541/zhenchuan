const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip lint & type errors during production builds
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  reactStrictMode: true,

  /**
   * ❗ DO NOT set `outputFileTracing: false`
   * This option DOES NOT EXIST in Next 15.
   *
   * Tracing is only triggered when:
   *   output === "standalone"
   *
   * Since we are NOT using standalone,
   * tracing will NOT run.
   */

  // ✅ Default output (no tracing, no standalone)
  // output: undefined  ← implicit default, do NOT set

  /**
   * Reduce build parallelism to avoid memory spikes
   * on constrained VMs
   */
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.parallelism = 1;
    }
    return config;
  },

  /**
   * ✅ Rewrites for API proxying
   * In development: /api/* → http://127.0.0.1:5000/api/*
   * This avoids CORS issues by proxying through Next.js
   */
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: 'http://127.0.0.1:5000/api/:path*',
        },
        {
          source: '/full-exports/:path*',
          destination: 'http://127.0.0.1:5000/full-exports/:path*',
        },
      ],
    };
  },
};

module.exports = withBundleAnalyzer(nextConfig);
