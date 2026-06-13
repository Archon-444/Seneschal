import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    // Document/OCR uploads flow through server actions; the default 1 MB body
    // cap rejects real contracts and scans. Match the 15 MB ceiling the
    // external proof-upload path already enforces (link/[token]/actions.ts).
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
