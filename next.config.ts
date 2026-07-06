import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-mode indicator badge sits bottom-left and overlaps the
  // sidebar's "Çıkış Yap" button — disable it so the demo UI is clean
  // even when running `next dev`.
  devIndicators: false,
};

export default nextConfig;
