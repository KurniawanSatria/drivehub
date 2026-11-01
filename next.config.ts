import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // folder ini ada di dalam project yang punya bun.lock lain, kunci root biar turbopack
  // ga ngawasin seluruh folder induk
  turbopack: { root: process.cwd() },
};

export default nextConfig;
