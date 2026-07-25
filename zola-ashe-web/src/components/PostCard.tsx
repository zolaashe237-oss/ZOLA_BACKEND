"use client";

import type { Post } from "@/lib/types";
import { Card } from "@/components/ui";
import { IconHeart, IconComment } from "@/components/icons";

function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "à l’instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  if (d < 604800) return `il y a ${Math.floor(d / 86400)} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function PostCard({ post, onLike }: { post: Post; onLike: (p: Post) => void }) {
  const initial = (post.author.full_name?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <Card hover className="post-card">
      <div style={{ display: "flex", gap: ".8rem", alignItems: "center" }}>
        <span className="avatar">{initial}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "1rem" }}>{post.author.full_name}</strong>
            {post.is_announcement && <span className="chip-mini" style={{ background: "rgba(201,162,39,.16)", borderColor: "var(--line)" }}>Annonce</span>}
            {post.is_pinned && <span style={{ fontSize: ".75rem", color: "var(--gold)" }}>📌</span>}
          </div>
          <span style={{ fontSize: ".78rem", color: "var(--muted-2)" }}>{timeAgo(post.created_at)}</span>
        </div>
      </div>

      {post.text && (
        <p style={{ margin: ".85rem 0 .4rem", color: "var(--cream)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {post.text}
        </p>
      )}

      <div style={{ display: "flex", gap: "1.4rem", alignItems: "center", marginTop: ".5rem",
                    paddingTop: ".7rem", borderTop: "1px solid var(--line-soft)" }}>
        <button className={`like-btn ${post.liked_by_me ? "on" : ""}`} onClick={() => onLike(post)}>
          <IconHeart className="" filled={post.liked_by_me} /> {post.likes_count}
        </button>
        <span className="feed-meta"><IconComment className="" /> {post.comments_count}</span>
      </div>
    </Card>
  );
}
