// Appels API du back-office. Tout passe par le client `api` (Bearer + refresh auto).
import { api } from "./api";
import type {
  Article,
  AuditEntry,
  CourseItem,
  DashboardKPIs,
  Formation,
  MemberDetail,
  ModuleItem,
  Paginated,
  QuizItem,
  ReportItem,
  ResourceItem,
  User,
} from "./types";

export const authApi = {
  login: (data: { email: string; password: string }) =>
    api.post<{ access: string; user: User }>("/auth/login/", data),
  refresh: () => api.post<{ access: string }>("/auth/refresh/"),
  logout: () => api.post("/auth/logout/"),
  me: () => api.get<User>("/me/"),
};

export const dashboardApi = {
  kpis: () => api.get<DashboardKPIs>("/admin/dashboard/"),
};

export const membersApi = {
  list: (params?: { status?: string; search?: string }) =>
    api.get<Paginated<User>>("/admin/members/", { params }),
  detail: (id: number) => api.get<MemberDetail>(`/admin/members/${id}/`),
  block: (id: number, reason: string) => api.post(`/admin/members/${id}/block/`, { reason }),
  unblock: (id: number) => api.post(`/admin/members/${id}/unblock/`),
  warn: (id: number, reason: string) =>
    api.post<{ nb_warnings: number; recidive_alert: boolean }>(`/admin/members/${id}/warn/`, { reason }),
  resetPassword: (id: number) => api.post(`/admin/members/${id}/reset-password/`),
};

type List<T> = T[] | Paginated<T>;

export const formationApi = {
  list: () => api.get<List<Formation>>("/admin/formations/"),
  detail: (id: number) => api.get<Formation>(`/admin/formations/${id}/`),
  create: (data: Partial<Formation>) => api.post<Formation>("/admin/formations/", data),
  update: (id: number, data: Partial<Formation>) => api.patch<Formation>(`/admin/formations/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/formations/${id}/`),
  publish: (id: number) => api.post<Formation>(`/admin/formations/${id}/publish/`),
};

export const moduleApi = {
  list: (formationId: number) =>
    api.get<List<ModuleItem>>("/admin/modules/", { params: { formation: formationId } }),
  create: (data: Partial<ModuleItem>) => api.post<ModuleItem>("/admin/modules/", data),
  update: (id: number, data: Partial<ModuleItem>) => api.patch<ModuleItem>(`/admin/modules/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/modules/${id}/`),
};

export const courseApi = {
  list: (moduleId: number) =>
    api.get<List<CourseItem>>("/admin/courses/", { params: { module: moduleId } }),
  create: (data: Partial<CourseItem>) => api.post<CourseItem>("/admin/courses/", data),
  update: (id: number, data: Partial<CourseItem>) => api.patch<CourseItem>(`/admin/courses/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/courses/${id}/`),
};

export const resourceApi = {
  list: (courseId: number) =>
    api.get<List<ResourceItem>>("/admin/resources/", { params: { course: courseId } }),
  create: (data: Partial<ResourceItem>) => api.post<ResourceItem>("/admin/resources/", data),
  update: (id: number, data: Partial<ResourceItem>) => api.patch<ResourceItem>(`/admin/resources/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/resources/${id}/`),
  // Upload du média (vidéo/PDF/audio) vers MinIO → renvoie la clé bucket.
  upload: (file: File, contentType: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("content_type", contentType);
    return api.post<{ bucket_key: string; size_mo: number }>("/admin/content/upload/", fd);
  },
  preview: (id: number) =>
    api.get<{ url: string; resource_type: string }>(`/admin/resources/${id}/preview/`),
};

export const quizApi = {
  list: (formationId: number) =>
    api.get<List<QuizItem>>("/admin/quizzes/", { params: { formation: formationId } }),
  create: (data: Partial<QuizItem>) => api.post<QuizItem>("/admin/quizzes/", data),
  update: (id: number, data: Partial<QuizItem>) => api.patch<QuizItem>(`/admin/quizzes/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/quizzes/${id}/`),
};

export const resetQuizApi = (data: { user_id: number; quiz_id: number; reason: string }) =>
  api.post("/admin/quiz/reset/", data);

/** Normalise une réponse liste paginée ou non en tableau. */
export function asList<T>(data: T[] | Paginated<T>): T[] {
  return Array.isArray(data) ? data : data.results;
}

export const financeApi = {
  manual: (data: { user_id: number; kind: string; amount?: number; reason: string }) =>
    api.post("/admin/payments/manual/", data),
  refund: (data: { user_id: number; amount: number; reason: string }) =>
    api.post("/admin/payments/refund/", data),
  exonerate: (data: { user_id: number; reason: string }) =>
    api.post("/admin/payments/exonerate/", data),
  sendReminders: () => api.post<{ reminded: number }>("/admin/reminders/send/"),
  exportMembers: () => api.get("/admin/exports/members.csv", { responseType: "blob" }),
  exportPayments: () => api.get("/admin/exports/payments.csv", { responseType: "blob" }),
};

/** Déclenche le téléchargement d'un blob renvoyé par l'API (CSV authentifié). */
export function downloadBlob(data: Blob, filename: string) {
  const url = window.URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

export const blogApi = {
  list: () => api.get<Article[] | Paginated<Article>>("/admin/blog/"),
  create: (data: Partial<Article>) => api.post<Article>("/admin/blog/", data),
  update: (id: number, data: Partial<Article>) => api.patch(`/admin/blog/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/blog/${id}/`),
};

export const moderationApi = {
  reports: () => api.get<ReportItem[]>("/admin/reports/"),
  handle: (id: number) => api.post(`/admin/reports/${id}/handle/`),
  deletePost: (id: number, reason: string) => api.post(`/admin/posts/${id}/delete/`, { reason }),
  deleteComment: (id: number, reason: string) => api.post(`/admin/comments/${id}/delete/`, { reason }),
};

export const auditApi = {
  list: (params?: { action?: string }) =>
    api.get<Paginated<AuditEntry>>("/admin/audit/", { params }),
};
