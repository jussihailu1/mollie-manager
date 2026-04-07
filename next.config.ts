import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['wise-kangaroo-rare.ngrok-free.app']
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
