"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { meApi } from "@/lib/endpoints";
import { Alert, Button, Card, Input, errorMessage } from "@/components/ui";

export default function ProfilPage() {
  const { user, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      await meApi.update({ full_name: fullName });
      await refreshUser();
      setInfo("Profil mis à jour.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="eyebrow" style={{ marginBottom: ".4rem" }}>Compte</div>
      <h1 style={{ marginBottom: "1.6rem", fontSize: "2.4rem" }}>Mon profil</h1>
      <Card>
        <Alert>{error}</Alert>
        <Alert kind="success">{info}</Alert>
        <form onSubmit={save}>
          <Input label="Email" value={user.email} disabled />
          <Input label="Nom complet" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Button type="submit" loading={loading} block>Enregistrer</Button>
        </form>
      </Card>

      <button className="btn btn-ghost press" style={{ width: "100%", marginTop: "1rem" }}
              onClick={() => logout().then(() => router.replace("/login"))}>
        Se déconnecter
      </button>
    </div>
  );
}
