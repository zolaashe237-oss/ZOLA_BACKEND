/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // En-têtes de sécurité (CDC §7.3) — complétés côté Traefik/Cloudflare.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
