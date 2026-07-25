"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { setAccessToken } from "@/lib/api";
import { authApi } from "@/lib/endpoints";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Erreur levée si un compte non-admin tente d'accéder au back-office. */
class NotAdminError extends Error {
  constructor() {
    super("Accès réservé aux administrateurs.");
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Refresh silencieux au montage (cookie HttpOnly) ; on n'admet que les ADMIN.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await authApi.refresh();
        setAccessToken(data.access);
        const me = await authApi.me();
        if (me.data.role !== "ADMIN") throw new NotAdminError();
        setUser(me.data);
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await authApi.login({ email, password });
    if (data.user.role !== "ADMIN") {
      // Ne pas conserver de session pour un compte non administrateur.
      setAccessToken(null);
      throw new NotAdminError();
    }
    setAccessToken(data.access);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>.");
  return ctx;
}
