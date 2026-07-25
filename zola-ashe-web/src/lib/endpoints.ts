// Fonctions d'appel à l'API, typées. Toutes passent par le client `api`
// (injection du Bearer + refresh automatique sur 401).
import { api } from "./api";
import type {
  Article,
  FormationDetail,
  FormationListItem,
  Paginated,
  Post,
  QuizPublic,
  QuizSubmitResult,
  Subscription,
  User,
} from "./types";

// ─── Auth ───────────────────────────────────────────────────────────────────
export const authApi = {
  register: (data: { email: string; full_name: string; password: string; password2: string }) =>
    api.post<{ detail: string; dev_code?: string }>("/auth/register/", data),

  verifyOtp: (data: { email: string; code: string }) =>
    api.post("/auth/verify-otp/", data),

  resendOtp: (email: string) => api.post<{ detail: string; dev_code?: string }>("/auth/resend-otp/", { email }),

  login: (data: { email: string; password: string }) =>
    api.post<{ access: string; user: User }>("/auth/login/", data),

  refresh: () => api.post<{ access: string }>("/auth/refresh/"),

  logout: () => api.post("/auth/logout/"),

  passwordForgot: (email: string) =>
    api.post<{ detail: string; dev_code?: string }>("/auth/password/forgot/", { email }),

  passwordReset: (data: { email: string; code: string; new_password: string }) =>
    api.post("/auth/password/reset/", data),
};

// ─── Profil ───────────────────────────────────────────────────────────────────
export const meApi = {
  get: () => api.get<User>("/me/"),
  update: (data: Partial<Pick<User, "full_name">>) => api.patch<User>("/me/", data),
};

// ─── Formations (catalogue + arbre modules → cours) ───────────────────────────
export const formationApi = {
  list: (params?: { category?: string }) =>
    api.get<Paginated<FormationListItem>>("/formations/", { params }),

  detail: (id: number) => api.get<FormationDetail>(`/formations/${id}/`),
};

// ─── Ressources (lecture : lien YouTube ou URL signée) ────────────────────────
export const resourceApi = {
  stream: (id: number) =>
    api.get<{ kind: "youtube" | "file"; url: string; expires_in?: number }>(
      `/resources/${id}/stream/`,
    ),
};

// ─── QCM (passage + notation serveur) ─────────────────────────────────────────
export const quizApi = {
  get: (id: number) => api.get<QuizPublic>(`/quizzes/${id}/`),

  submit: (id: number, answers: Record<string, number[]>) =>
    api.post<QuizSubmitResult>(`/quizzes/${id}/submit/`, { answers }),

  result: (id: number) =>
    api.get<{ quiz?: number; score?: number; validated?: boolean }>(`/quizzes/${id}/result/`),
};

// ─── Billing ──────────────────────────────────────────────────────────────────
export const billingApi = {
  subscriptionTypes: () =>
    api.get<{ kind: string; label: string; amount: number }[]>("/billing/subscription-types/"),

  initiate: (kind: string, amount?: number) =>
    api.post<{ checkout_url: string; reference: string; amount: number; mock?: boolean }>(
      "/billing/payments/initiate/",
      { kind, ...(amount ? { amount } : {}) },
    ),

  mockConfirm: (reference: string) =>
    api.post<{ confirmed: boolean; kind: string }>("/billing/payments/mock-confirm/", { reference }),

  mySubscriptions: () =>
    api.get<Subscription[] | Paginated<Subscription>>("/billing/subscriptions/"),

  myPayments: () => api.get<Paginated<unknown>>("/billing/payments/"),
};

// ─── Blog / Journal (public) ──────────────────────────────────────────────────
export const blogApi = {
  list: () => api.get<Article[] | { results: Article[] }>("/blog/"),
  detail: (slug: string) => api.get<Article>(`/blog/${slug}/`),
};

// ─── Communauté ───────────────────────────────────────────────────────────────
export const communityApi = {
  feed: () => api.get<Paginated<Post>>("/community/posts/"),

  createPost: (data: { text: string; audience?: string }) =>
    api.post<Post>("/community/posts/", data),

  toggleLike: (id: number) =>
    api.post<{ liked: boolean; likes_count: number }>(`/community/posts/${id}/like/`),

  comments: (id: number) => api.get(`/community/posts/${id}/comments/`),

  addComment: (id: number, text: string) =>
    api.post(`/community/posts/${id}/comments/`, { text }),

  report: (data: { target_type: "POST" | "COMMENT"; target_id: number; reason: string }) =>
    api.post("/community/reports/", data),
};
