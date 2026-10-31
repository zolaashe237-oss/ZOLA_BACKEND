/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.zola-ashe.com" },
      { protocol: "https", hostname: "*.zola-ashe.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
  // Dashboard admin : en-têtes durcis + interdiction d'indexation.
  // Le CSP (nonce dynamique) est géré par src/middleware.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options",  value: "nosniff" },
          { key: "X-Frame-Options",          value: "DENY" },
          { key: "Referrer-Policy",          value: "strict-origin-when-cross-origin" },
          { key: "X-Robots-Tag",             value: "noindex, nofollow" },
          // HSTS — 2 ans, sous-domaines inclus (Vercel force HTTPS en prod)
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Verrouillage des APIs navigateur non utilisées par le dashboard
          {
            key: "Permissions-Policy",
            value: [
              "camera=()",
              "microphone=()",
              "geolocation=()",
              "payment=()",
              "usb=()",
              "display-capture=()",
              "interest-cohort=()",
            ].join(", "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
