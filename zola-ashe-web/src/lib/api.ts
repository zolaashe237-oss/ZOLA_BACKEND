import axios from "axios";

/**
 * Client API partagé.
 * - access JWT gardé en mémoire (jamais en localStorage → protège du XSS, CDC §7).
 * - refresh token en cookie HttpOnly géré côté backend.
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Rafraîchissement automatique sur 401 (rotation des tokens, CDC §7).
// Le refresh token vit dans un cookie HttpOnly → renvoyé via withCredentials.
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    // Ne jamais relancer un refresh sur une route /auth/ (sinon le 401 du
    // refresh lui-même rappelle le refresh → blocage). Laisse passer l'erreur.
    const isAuthRoute = typeof original?.url === "string" && original.url.includes("/auth/");
    if (error.response?.status === 401 && original && !original._retry && !isAuthRoute) {
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
  }
);
