import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  // Origine de l'API (pour connect-src)
  let apiOrigin = "";
  try {
    apiOrigin = new URL(
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8010"
    ).origin;
  } catch {
    // URL invalide ou absente → connect-src 'self' uniquement
  }

  const directives: string[] = [
    `default-src 'none'`,
    // En dev : unsafe-eval pour le hot-reload Next.js
    // En prod : strict-dynamic pour propager la confiance aux scripts chargés dynamiquement
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // unsafe-inline nécessaire pour les styles inline du dashboard
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https://cdn.zola-ashe.com https://*.zola-ashe.com https://i.ytimg.com https://img.youtube.com https://*.r2.cloudflarestorage.com ${apiOrigin}`,
    [
      `connect-src 'self'`,
      `https://cdn.zola-ashe.com`,
      `https://*.zola-ashe.com`,
      apiOrigin,
      // En dev : websockets Next.js HMR
      isDev ? "ws://localhost:* http://localhost:*" : "",
    ]
      .filter(Boolean)
      .join(" "),
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ];

  return directives.join("; ");
}

export function middleware(request: NextRequest) {
  // btoa(randomUUID()) → nonce base64 sûr, compatible Edge Runtime
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // Transmet le nonce au layout via l'en-tête de requête
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: [
    {
      // Exclure les assets statiques et les images optimisées
      source:
        "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
