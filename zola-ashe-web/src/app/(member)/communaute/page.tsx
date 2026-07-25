"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { communityApi } from "@/lib/endpoints";
import type { Post } from "@/lib/types";
import { Alert, Button, Card, errorMessage } from "@/components/ui";
import { PostCard } from "@/components/PostCard";
import { BrandLoader } from "@/components/BrandLoader";

export default function CommunautePage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = () => communityApi.feed().then((r) => setPosts(r.data.results)).catch(() => setPosts([]));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!text.trim()) return;
    setSending(true);
    try {
      const { data } = await communityApi.createPost({ text });
      setPosts([data, ...posts]);
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const like = async (post: Post) => {
    const { data } = await communityApi.toggleLike(post.id);
    setPosts((cur) => cur.map((p) =>
      p.id === post.id ? { ...p, liked_by_me: data.liked, likes_count: data.likes_count } : p));
  };

  if (loading) return <BrandLoader full={false} />;

  const initial = (user?.full_name?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div className="fade-up">
      <div className="eyebrow" style={{ marginBottom: ".3rem" }}>Le fil d’échanges</div>
      <h1 style={{ marginBottom: "1.1rem", fontSize: "clamp(1.8rem, 5vw, 2.4rem)" }}>Communauté</h1>

      {/* Composeur */}
      <Card style={{ marginBottom: "1.4rem" }}>
        <Alert>{error}</Alert>
        <form onSubmit={publish} style={{ display: "flex", gap: ".8rem", alignItems: "flex-start" }}>
          <span className="avatar">{initial}</span>
          <div style={{ flex: 1 }}>
            <textarea value={text} maxLength={2000} rows={2}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Partagez une pensée, une intention, une question…"
                      className="input" style={{ resize: "vertical", fontFamily: "var(--sans)", minHeight: 52 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: ".6rem" }}>
              <Button type="submit" loading={sending} disabled={!text.trim()}
                      style={{ padding: ".55rem 1.4rem" }}>Publier</Button>
            </div>
          </div>
        </form>
      </Card>

      {/* Fil */}
      <div style={{ display: "grid", gap: "0.9rem" }}>
        {posts.map((p) => <PostCard key={p.id} post={p} onLike={like} />)}
        {posts.length === 0 && (
          <Card><p style={{ color: "var(--muted)" }}>Aucune publication pour le moment. Soyez le premier à partager.</p></Card>
        )}
      </div>
    </div>
  );
}
