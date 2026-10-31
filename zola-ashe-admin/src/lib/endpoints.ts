// Appels API du back-office. Tout passe par le client `api` (Bearer + refresh auto).
import { api } from "./api";
import type {
  AIGeneratedQuestion,
  AIGenerationConfig,
  AIQuizHistoryEntry,
  AIQuizJob,
  AIQROReviewItem,
  QuizChoice,
  Article,
  AudioItem,
  AuditEntry,
  Branche,
  CommunityChannel,
  CommunityPost,
  CourseItem,
  DashboardKPIs,
  Formation,
  FormationProgressStat,
  LateMember,
  LibraryPdf,
  LiveSession,
  MemberDetail,
  MemberProgressEntry,
  ModuleItem,
  MonthlyRevenue,
  Paginated,
  PaymentBreakdown,
  ProgressionKPIs,
  QuizItem,
  QuizResult,
  QuizResultAnswers,
  ReportItem,
  ResourceItem,
  SocialLinksConfig,
  SubscriptionPlan,
  Transaction,
  TransactionKPIs,
  User,
  YoutubeChapterImportResult,
  YoutubeImportPreview,
  YoutubeImportResult,
  AffiliateConfig,
  AffiliateStats,
  FeatureSettings,
  Referral as AffiliateReferral,
} from "./types";

export const authApi = {
  login: (data: { email: string; password: string }) =>
    api.post<{ access?: string; user?: User; requires_otp?: boolean }>("/auth/login/", data),
  verifyOtp: (data: { email: string; code: string }) =>
    api.post<{ access: string; user: User }>("/auth/verify-otp/", data),
  resendOtp: (data: { email: string }) =>
    api.post("/auth/resend-otp/", data),
  refresh: () => api.post<{ access: string }>("/auth/refresh/"),
  logout: () => api.post("/auth/logout/"),
  me: () => api.get<User>("/me/"),
};

// ── Compte admin courant & gestion de l'équipe ───────────────────────────────

export const adminAccountApi = {
  // Profil de l'admin connecté
  updateMe: (data: { full_name?: string; email?: string }) =>
    api.patch<User>("/me/", data),
  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post("/me/change-password/", data),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ url: string; key: string }>("/me/avatar/", fd);
  },

  // Gestion de l'équipe admin
  listAdmins: () =>
    api.get<User[] | Paginated<User>>("/admin/admins/"),
  createAdmin: (data: {
    email: string;
    full_name: string;
    password: string;
    is_super_admin?: boolean;
  }) => api.post<User>("/admin/admins/", data),
  updateAdmin: (id: number, data: Partial<User>) =>
    api.patch<User>(`/admin/admins/${id}/`, data),
  deactivateAdmin: (id: number, reason: string) =>
    api.post(`/admin/admins/${id}/deactivate/`, { reason }),
  activateAdmin: (id: number) =>
    api.post(`/admin/admins/${id}/activate/`),
  resetAdminPassword: (id: number) =>
    api.post<{ temp_password: string }>(`/admin/admins/${id}/reset-password/`),
  removeAdmin: (id: number) =>
    api.delete(`/admin/admins/${id}/`),
};

export const dashboardApi = {
  kpis: (params?: { date_from?: string; date_to?: string }) =>
    api.get<DashboardKPIs>("/admin/dashboard/", { params }),
};

export const membersApi = {
  list: (params?: { status?: string; search?: string; page_size?: number }) =>
    api.get<Paginated<User>>("/admin/members/", { params }),
  detail: (id: number) => api.get<MemberDetail>(`/admin/members/${id}/`),
  create: (data: { email: string; full_name: string; password: string; access_levels?: string[] }) =>
    api.post<User>("/admin/members/", data),
  update: (id: number, data: { full_name?: string; email?: string; phone?: string | null; country?: string | null; access_levels?: string[] }) =>
    api.patch<User>(`/admin/members/${id}/`, data),
  block: (id: number, reason: string) => api.post(`/admin/members/${id}/block/`, { reason }),
  unblock: (id: number) => api.post(`/admin/members/${id}/unblock/`),
  warn: (id: number, reason: string) =>
    api.post<{ nb_warnings: number; recidive_alert: boolean }>(`/admin/members/${id}/warn/`, { reason }),
  resetPassword: (id: number) =>
    api.post<{ temp_password: string }>(`/admin/members/${id}/reset-password/`),
  delete: (id: number) => api.delete(`/admin/members/${id}/`),
  lateCotisations: () => api.get<LateMember[] | Paginated<LateMember>>("/admin/members/late/"),
};

type List<T> = T[] | Paginated<T>;

export const formationApi = {
  list: () => api.get<List<Formation>>("/admin/formations/"),
  detail: (id: number) => api.get<Formation>(`/admin/formations/${id}/`),
  create: (data: Partial<Formation>) => api.post<Formation>("/admin/formations/", data),
  update: (id: number, data: Partial<Formation>) => api.patch<Formation>(`/admin/formations/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/formations/${id}/`),
  hardDelete: (id: number) => api.delete(`/admin/formations/${id}/hard-delete/`),
  publish: (id: number) => api.post<Formation>(`/admin/formations/${id}/publish/`),
  reorder: (items: { id: number; order: number }[]) =>
    api.post("/admin/formations/reorder/", { items }),
  uploadCover: (id: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ url: string; key: string }>(`/admin/formations/${id}/cover/`, fd);
  },
};


// ── Import automatique de formation depuis une playlist YouTube (F2) ─────────
// F2-B (Edwin) : POST /api/admin/formations/import-youtube/

export const youtubeImportApi = {
  preview: async (playlistUrl: string): Promise<{ preview: YoutubeImportPreview; simulated: boolean }> => {
    try {
      const { data } = await api.post<YoutubeImportPreview>(
        "/admin/formations/import-youtube/",
        { playlist_url: playlistUrl, mode: "preview" },
      );
      return { preview: data, simulated: false };
    } catch {
      return {
        preview: {
          formation_title: "Formation importée (aperçu simulé)",
          playlist_url: playlistUrl,
          modules: [
            {
              title: "Module 1",
              courses: [
                { title: "Introduction", youtube_url: playlistUrl, duration_sec: 480 },
                { title: "Notions de base", youtube_url: playlistUrl, duration_sec: 620 },
              ],
            },
          ],
          total_videos: 2,
        },
        simulated: true,
      };
    }
  },

  confirm: async (playlistUrl: string): Promise<YoutubeImportResult> => {
    const { data } = await api.post<YoutubeImportResult>(
      "/admin/formations/import-youtube/",
      { playlist_url: playlistUrl, mode: "confirm" },
    );
    return { ...data, simulated: false };
  },

  confirmChapter: async (playlistUrl: string, formationId: number): Promise<YoutubeChapterImportResult> => {
    const { data } = await api.post<YoutubeChapterImportResult>(
      "/admin/formations/import-youtube/",
      { playlist_url: playlistUrl, mode: "confirm", import_mode: "chapter", formation_id: formationId },
    );
    return data;
  },
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
  listAll: (params?: { formation?: number; course?: number; source?: "AI" | "MANUAL" }) =>
    api.get<List<QuizItem>>("/admin/quizzes/", { params }),
  create: (data: Partial<QuizItem>) => api.post<QuizItem>("/admin/quizzes/", data),
  update: (id: number, data: Partial<QuizItem>) => api.patch<QuizItem>(`/admin/quizzes/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/quizzes/${id}/`),
  listByBranch: async (branche: Branche): Promise<QuizItem[]> => {
    const { data } = await api.get<List<QuizItem>>("/admin/quizzes/", { params: { branche } });
    return asList(data);
  },
};

// ── Agent IA - Génération de quiz (Gemini) ────────────────────────────────────

function toBackendGenerationPayload(config: AIGenerationConfig) {
  const sourceTypeMap: Record<string, string> = {
    SCRIPT: "VIDEO_YOUTUBE",
    PDF: "PDF",
    MULTI_YOUTUBE: "MULTI_YOUTUBE",
  };
  return {
    module_id: config.moduleId,
    source_type: sourceTypeMap[config.source] ?? config.source,
    source_ref: config.source_ref ?? "",
    source_text: config.source_text ?? "",
    nb_questions: config.nb_questions,
    nb_qcm_multi: config.nb_qcm_multi ?? 0,
    ratio_qcm_qro: config.ratio_qcm_qro,
    difficulty: config.difficulty,
    formation_title: config.formation_title ?? "",
    module_title: config.module_title ?? "",
  };
}

export const aiQuizApi = {
  generate: async (config: AIGenerationConfig): Promise<{ job_id: string }> => {
    const { data } = await api.post<{ id: string }>(
      "/admin/quiz/generate-ai/", toBackendGenerationPayload(config),
    );
    return { job_id: data.id };
  },

  status: async (jobId: string): Promise<AIQuizJob> => {
    const { data } = await api.get<any>(`/admin/quiz/generate-ai/${jobId}/`);
    const progressMap: Record<string, number> = { PENDING: 10, IN_PROGRESS: 50, DONE: 100, FAILED: 0 };
    const questions: AIGeneratedQuestion[] = (data.questions ?? []).map(
      (q: any, idx: number): AIGeneratedQuestion => {
        const texts: string[] = q.choices ?? [];
        const corrIdx: number | null = q.correct_index ?? null;
        const corrIdxs: number[] = q.correct_indices ?? [];
        const choices: QuizChoice[] = texts.map((text, i) => ({
          text,
          is_correct: q.kind === "QCM_MULTI" ? corrIdxs.includes(i) : i === corrIdx,
          order: i,
        }));
        return {
          client_id: String(q.id),
          type: q.kind,
          text: q.text,
          choices,
          criteria: q.criteria ?? [],
          difficulty: data.suggested_level ?? "INTERMEDIAIRE",
          suggested_rank: data.suggested_rank ?? (idx + 1),
        };
      }
    );
    return {
      job_id: data.id,
      status: data.status,
      progress: progressMap[data.status] ?? 0,
      niveau_suggere: data.suggested_level ?? null,
      rang_suggere: data.suggested_rank ?? null,
      questions: data.status === "DONE" ? questions : undefined,
      error: data.error_message ?? "",
    };
  },

  regenerateQuestion: async (
    config: AIGenerationConfig, type: "QCM" | "QCM_MULTI" | "QRO", order: number,
  ): Promise<AIGeneratedQuestion> => {
    const { data } = await api.post<AIGeneratedQuestion>(
      "/admin/quiz/generate-ai/",
      { ...toBackendGenerationPayload(config), regenerate_only: type, regenerate_order: order },
    );
    return data;
  },
};

// ── File de revue QRO ambiguë (G-06) ──────────────────────────────────────────

export const qroReviewApi = {
  list: async (): Promise<AIQROReviewItem[]> => {
    const { data } = await api.get<AIQROReviewItem[] | Paginated<AIQROReviewItem>>("/admin/quiz/qro-review/");
    return asList(data);
  },
  decide: async (id: number, decision: "VALIDER" | "INVALIDER"): Promise<void> => {
    const backendDecision = decision === "VALIDER" ? "VALIDATED" : "REJECTED";
    await api.post(`/admin/quiz/qro-review/${id}/decide/`, { decision: backendDecision });
  },
};

// ── Historique des générations IA (G-07) ──────────────────────────────────────

export const quizHistoryApi = {
  list: async (): Promise<AIQuizHistoryEntry[]> => {
    const { data } = await api.get<QuizItem[] | Paginated<QuizItem>>(
      "/admin/quizzes/", { params: { generated_by_ai: true } },
    );
    return asList(data).map((q): AIQuizHistoryEntry => ({
      id: q.id,
      quiz_title: q.title,
      source_title: "",
      ai_source: q.ai_source ?? null,
      generated_by_ai: q.generated_by_ai ?? false,
      validated_by: null,
      status: q.status ?? "DRAFT",
      niveau: q.niveau ?? null,
      created_at: q.created_at,
    }));
  },
};

export const resetQuizApi = (data: { user_id: number; quiz_id: number; reason: string }) =>
  api.post("/admin/quiz/reset/", data);

export const setQuizScoreApi = (data: { user_id: number; quiz_id: number; score: number }) =>
  api.post("/admin/quiz/score/", data);

export const quizResultsApi = {
  list: (params?: { quiz_id?: number; formation_id?: number; search?: string }) =>
    api.get<QuizResult[] | Paginated<QuizResult>>("/admin/quiz/results/", { params }),
  answers: (id: number) =>
    api.get<QuizResultAnswers>(`/admin/quiz/results/${id}/answers/`),
};

export const financeApi2 = {
  monthlyRevenue:   (params?: { date_from?: string; date_to?: string }) =>
    api.get<MonthlyRevenue[]>("/admin/finance/monthly/", { params }),
  lateCotisations:  () => api.get<LateMember[] | Paginated<LateMember>>("/admin/finance/late/"),
  paymentBreakdown: (params?: { date_from?: string; date_to?: string }) =>
    api.get<PaymentBreakdown[]>("/admin/finance/breakdown/", { params }),
};

/** Normalise une réponse liste paginée ou non en tableau. */
export function asList<T>(data: T[] | Paginated<T>): T[] {
  return Array.isArray(data) ? data : data.results;
}

export const financeApi = {
  manual: (data: { user_id: number; kind: string; amount?: number; reason?: string; formation_id?: number }) =>
    api.post("/admin/payments/manual/", data),
  refund: (data: { user_id: number; amount: number; reason: string; payment_id?: number; revoke_access?: boolean }) =>
    api.post<{ payment_id: number; access_revoked: boolean }>("/admin/payments/refund/", data),
  exonerate: (data: { user_id: number; reason: string }) =>
    api.post("/admin/payments/exonerate/", data),
  sendReminders: (data?: { user_id?: number }) =>
    api.post<{ reminded: number }>("/admin/reminders/send/", data ?? {}),
  exportMembers: (params?: { date_from?: string; date_to?: string }) =>
    api.get("/admin/exports/members.csv", { params, responseType: "blob" }),
  exportPayments: (params?: { date_from?: string; date_to?: string }) =>
    api.get("/admin/exports/payments.csv", { params, responseType: "blob" }),
};

export const billingPaymentsApi = {
  list: (params?: {
    page?: number;
    page_size?: number;
    kind?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
  }) => api.get<Transaction[] | Paginated<Transaction>>("/billing/payments/", { params }),
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
  createAdminPost: (data: { title?: string; text: string; is_announcement: boolean; is_pinned: boolean; audience?: string }) =>
    api.post("/admin/posts/", data),
};

export const auditApi = {
  list: (params?: { action?: string; date_from?: string; date_to?: string; page?: number; page_size?: number }) =>
    api.get<AuditEntry[] | Paginated<AuditEntry>>("/admin/audit/", { params }),
};

// ── Lives / Sessions en direct ──────────────────────────────────────────────

export const livesApi = {
  list: () => api.get<LiveSession[] | Paginated<LiveSession>>("/admin/lives/"),
  create: (data: Partial<LiveSession>) => api.post<LiveSession>("/admin/lives/", data),
  update: (id: number, data: Partial<LiveSession>) =>
    api.patch<LiveSession>(`/admin/lives/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/lives/${id}/`),
};

// ── Plans d'abonnement / Tarification ────────────────────────────────────────

export const plansApi = {
  list: () => api.get<SubscriptionPlan[] | Paginated<SubscriptionPlan>>("/admin/plans/"),
  create: (data: Partial<SubscriptionPlan>) =>
    api.post<SubscriptionPlan>("/admin/plans/", data),
  update: (id: number, data: Partial<SubscriptionPlan>) =>
    api.patch<SubscriptionPlan>(`/admin/plans/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/plans/${id}/`),
  toggle: (id: number) => api.post<SubscriptionPlan>(`/admin/plans/${id}/toggle/`),
};

// ── Transactions / Historique des paiements ───────────────────────────────────

export const transactionsApi = {
  kpis: () =>
    api.get<TransactionKPIs>("/admin/transactions/kpis/"),
  list: (params?: {
    status?:  string;
    kind?:    string;
    method?:  string;
    search?:  string;
    date_from?: string;
    date_to?:   string;
    page?:      number;
    page_size?: number;
  }) =>
    api.get<Transaction[] | Paginated<Transaction>>("/admin/transactions/", { params }),
  detail: (id: number) =>
    api.get<Transaction>(`/admin/transactions/${id}/`),
  export: () =>
    api.get("/admin/exports/payments.csv", { responseType: "blob" }),
};

// ── Communauté ────────────────────────────────────────────────────────────────

export const communityApi = {
  // Canaux
  listChannels: () =>
    api.get<CommunityChannel[] | Paginated<CommunityChannel>>("/admin/community/channels/"),
  createChannel: (data: Partial<CommunityChannel>) =>
    api.post<CommunityChannel>("/admin/community/channels/", data),
  updateChannel: (id: number, data: Partial<CommunityChannel>) =>
    api.patch<CommunityChannel>(`/admin/community/channels/${id}/`, data),
  removeChannel: (id: number) => api.delete(`/admin/community/channels/${id}/`),

  // Posts
  listPosts: (params?: { channel?: number; type?: string; status?: string; search?: string }) =>
    api.get<CommunityPost[] | Paginated<CommunityPost>>("/admin/community/posts/", { params }),
  createPost: (data: Partial<CommunityPost>) =>
    api.post<CommunityPost>("/admin/community/posts/", data),
  updatePost: (id: number, data: Partial<CommunityPost>) =>
    api.patch<CommunityPost>(`/admin/community/posts/${id}/`, data),
  removePost: (id: number) => api.delete(`/admin/community/posts/${id}/`),
  pinPost: (id: number) =>
    api.post<CommunityPost>(`/admin/community/posts/${id}/pin/`),
  moderatePost: (id: number, reason: string) =>
    api.post(`/admin/community/posts/${id}/moderate/`, { reason }),
};

// ── Progression des membres ───────────────────────────────────────────────────

export const progressionApi = {
  kpis: () =>
    api.get<ProgressionKPIs>("/admin/progression/kpis/"),
  formationStats: () =>
    api.get<FormationProgressStat[] | Paginated<FormationProgressStat>>("/admin/progression/stats/"),
  memberProgress: (params?: { formation_id?: number; search?: string; completed?: boolean }) =>
    api.get<MemberProgressEntry[] | Paginated<MemberProgressEntry>>(
      "/admin/progression/members/",
      { params },
    ),
  resetProgress: (data: { user_id: number; formation_id: number; reason: string }) =>
    api.post("/admin/progression/reset/", data),
};

// ── Audiothèque ───────────────────────────────────────────────────────────────

export const audioApi = {
  list:   ()                         => api.get<AudioItem[] | Paginated<AudioItem>>("/admin/audio/"),
  create: (data: Partial<AudioItem>) => api.post<AudioItem>("/admin/audio/", data),
  update: (id: number, data: Partial<AudioItem>) =>
    api.patch<AudioItem>(`/admin/audio/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/audio/${id}/`),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("content_type", "AUDIO");
    return api.post<{ bucket_key: string; size_mo: number; duration_sec: number }>(
      "/admin/content/upload/",
      fd,
    );
  },
};

// ── Bibliothèque PDF standalone ───────────────────────────────────────────────

export const libraryApi = {
  list: () => api.get<LibraryPdf[] | Paginated<LibraryPdf>>("/admin/library/"),
  listActive: async (): Promise<LibraryPdf[]> => {
    const { data } = await api.get<LibraryPdf[] | Paginated<LibraryPdf>>("/admin/library/", { params: { is_active: true } });
    return asList(data);
  },
  create: (data: Partial<LibraryPdf>) => api.post<LibraryPdf>("/admin/library/", data),
  update: (id: number, data: Partial<LibraryPdf>) =>
    api.patch<LibraryPdf>(`/admin/library/${id}/`, data),
  remove: (id: number) => api.delete(`/admin/library/${id}/`),
  reorder: (ids: number[]) => api.post("/admin/library/reorder/", { ids }),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("content_type", "PDF");
    return api.post<{ bucket_key: string; size_mo: number; nb_pages: number }>(
      "/admin/content/upload/",
      fd,
    );
  },
  uploadCover: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("content_type", "IMAGE");
    return api.post<{ bucket_key: string }>("/admin/content/upload/", fd);
  },
  pdfFirstPageCover: (bucket_key: string) =>
    api.post<{ bucket_key: string; preview_url: string }>("/admin/content/pdf-cover/", { bucket_key }),
};

export const socialLinksApi = {
  get: () => api.get<SocialLinksConfig>("/config/social-links/"),
  update: (data: Partial<SocialLinksConfig>) =>
    api.patch<SocialLinksConfig>("/config/social-links/", data),
};
export const featureSettingsApi = {
  get: () => api.get<FeatureSettings>("/admin/settings/features/"),
  update: (data: Partial<Pick<FeatureSettings, "quiz_enabled" | "monthly_subscription_enabled" | "hidden_sections">>) =>
    api.patch<FeatureSettings>("/admin/settings/features/", data),
};

// ── Mémoires admin ────────────────────────────────────────────────────────────
import type { MemoirEditorialStatus, MemoirSubmission, MemoirSubmissionDetail } from "./types";

// ── Notifications système admin ───────────────────────────────────────────────
export const notificationsAdminApi = {
  broadcast: (data: { title: string; body?: string; user_id?: number }) =>
    api.post<{ sent: number }>("/admin/notifications/broadcast/", data),
};

export const adminMemoirApi = {
  list: () =>
    api.get<MemoirSubmission[]>("/admin/memoir/"),
  detail: (id: number) =>
    api.get<MemoirSubmissionDetail>(`/admin/memoir/${id}/`),
  update: (id: number, data: { editorial_status?: MemoirEditorialStatus; editorial_notes?: string }) =>
    api.patch<MemoirSubmissionDetail>(`/admin/memoir/${id}/`, data),
  downloadDocx: (id: number) =>
    api.get(`/admin/memoir/${id}/docx/`, { responseType: "blob" }),
};

// ── Affiliation & Parrainage ──────────────────────────────────────────────────
export const affiliateAdminApi = {
  getConfig: () =>
    api.get<AffiliateConfig>("/admin/affiliate/config/"),
  updateConfig: (data: Partial<AffiliateConfig>) =>
    api.patch<AffiliateConfig>("/admin/affiliate/config/", data),
  getStats: () =>
    api.get<AffiliateStats>("/admin/affiliate/stats/"),
  listReferrals: (params?: { status?: string; search?: string; page?: number; page_size?: number }) =>
    api.get<Paginated<AffiliateReferral>>("/admin/affiliate/referrals/", { params }),
  markPaid: (ids: number[]) =>
    api.post<{ updated: number }>("/admin/affiliate/referrals/pay/", { ids }),
};
