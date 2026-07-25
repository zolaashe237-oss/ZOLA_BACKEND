"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "@/context/AuthContext";
import { CookieBanner } from "@/components/CookieBanner";

/** Regroupe les providers clients montés au-dessus de toute l'app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <CookieBanner />
    </AuthProvider>
  );
}
