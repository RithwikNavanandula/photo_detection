import type { NextConfig } from "next";

function resolveFlaskOrigin() {
  const raw = process.env.FLASK_ORIGIN || "http://127.0.0.1:5000";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, "");
  return `https://${raw.replace(/\/$/, "")}`;
}

const flaskOrigin = resolveFlaskOrigin();

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${flaskOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
