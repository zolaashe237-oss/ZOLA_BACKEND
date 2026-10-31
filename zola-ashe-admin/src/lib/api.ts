import axios from "axios";

/**
 * Client API du dashboard admin.
 * - access JWT gardé en mémoire (jamais en localStorage → protège du XSS).
 * - refresh token en cookie HttpOnly géré côté backend.
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8010/api",
  withCredentials: true,
});

/**
 * Résout une URL absolue pour un média.
 * Django retourne parfois des chemins relatifs (/media/...) en développement.
 */
export function getMediaUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("blob:") || path.startsWith("data:")) {
    return path;
  }
  
  // URL de base du serveur backend (sans le suffixe /api)
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8010/api";
  const serverRoot = apiBase.replace(/\/api$/, "").replace(/\/$/, "");
  
  return `${serverRoot}${path.startsWith("/") ? "" : "/"}${path}`;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Rafraîchissement automatique sur 401 (rotation des tokens).
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    // Ne jamais relancer un refresh sur une route /auth/ (sinon le 401 du
    // refresh lui-même rappelle le refresh → blocage). Laisse passer l'erreur.
    const isAuthRoute =
      typeof original?.url === "string" && original.url.includes("/auth/");
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !isAuthRoute
    ) {
      original._retry = true;
      try {
        refreshing =
          refreshing ??
          api
            .post("/auth/refresh/")
            .then((r) => r.data.access as string)
            .finally(() => {
              refreshing = null;
            });
        const newToken = await refreshing;
        setAccessToken(newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (e) {
        setAccessToken(null);
        return Promise.reject(e);
      }
    }
    return Promise.reject(error);
  },
);
