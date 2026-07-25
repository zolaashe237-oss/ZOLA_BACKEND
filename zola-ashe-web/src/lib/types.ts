// Types partagés du frontend, alignés sur les serializers DRF du backend.

export type UserStatus = "ACTIF" | "RESTREINT" | "BLOQUE";
export type Role = "MEMBER" | "ADMIN";
export type Category = "LIVRE" | "FORMATION" | "LIBRE";
export type ContentType = "VIDEO" | "PDF" | "AUDIO";
export type Audience = "TOUS" | "FEMME" | "ENFANT";

export interface User {
  id: number;
  email: string;
  full_name: string;
  photo: string | null;
  role: Role;
  status: UserStatus;
  email_verified: boolean;
  nb_warnings: number;
  created_at: string;
}

export interface AccessState {
  locked: boolean;
  lock_reason: "subscription" | "quiz" | null;
}

export type FormationStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED";
export type ResourceType = "VIDEO" | "PDF" | "AUDIO";

/** Formation du catalogue (liste). */
export interface FormationListItem {
  id: number;
  title: string;
  description: string;
  category: Category;
  cover: string;
  is_reserved: boolean;
  locked: boolean;
  module_count: number;
}

/** Ressource (média) d'un cours : vidéo (YouTube/fichier), PDF ou audio. */
export interface ResourceItem {
  id: number;
  resource_type: ResourceType;
  title: string;
  description: string;
  order: number;
  is_youtube: boolean;
  thumbnail: string;
  nb_pages: number | null;
  duration_sec: number | null;
  stream_available: boolean;
  youtube_url: string;
}

export interface QuizSummary {
  id: number;
  title: string;
  question_count: number;
  pass_threshold: number;
}

/** « Cours » : unité d'un module, avec ressources + QCM optionnel. */
export interface CourseNode {
  id: number;
  title: string;
  description: string;
  order: number;
  access: AccessState;
  completed: boolean;
  resources: ResourceItem[];
  quiz: QuizSummary | null;
}

/** Nœud de l'arborescence des modules (récursif). */
export interface ModuleNode {
  id: number;
  title: string;
  description: string;
  order: number;
  access: AccessState;
  completed: boolean;
  courses: CourseNode[];
  children: ModuleNode[];
}

export interface FinalExam {
  id: number;
  title: string;
  question_count: number;
  pass_threshold: number;
  locked: boolean;
  lock_reason: "subscription" | "quiz" | null;
  validated: boolean;
  score: number | null;
}

/** Formation détaillée : arbre des modules → cours + examen final. */
export interface FormationDetail {
  id: number;
  title: string;
  description: string;
  category: Category;
  cover: string;
  is_reserved: boolean;
  locked: boolean;
  modules: ModuleNode[];
  final_exam: FinalExam | null;
}

export interface QuizChoice {
  id: number;
  text: string;
}

export interface QuizQuestion {
  id: number;
  text: string;
  multiple: boolean;
  choices: QuizChoice[];
}

export interface QuizPublic {
  id: number;
  title: string;
  pass_threshold: number;
  is_final: boolean;
  questions: QuizQuestion[];
}

export interface QuizSubmitResult {
  score: number;
  last_score: number;
  correct: number;
  total: number;
  attempts: number;
  validated: boolean;
  validated_at: string | null;
  pass_threshold: number;
}

export interface Subscription {
  id: number;
  type: string;
  start: string;
  end: string | null;
  active: boolean;
  in_tranches: boolean;
  created_at: string;
}

export interface Author {
  id: number;
  full_name: string;
  photo: string | null;
}

export interface Article {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  cover_url: string;
  category: string;
  author_name: string;
  published_at: string | null;
  body?: string;
}

export interface Post {
  id: number;
  author: Author;
  text: string;
  image: string | null;
  video: string | null;
  audience: Audience;
  is_pinned: boolean;
  is_announcement: boolean;
  likes_count: number;
  liked_by_me: boolean;
  comments_count: number;
  shared_from: number | null;
  created_at: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
