"""Services de la communauté (RG-29 à RG-34).

La communauté est unique (plus de branches Femme/Enfant) : un membre ACTIF
voit et publie sur l'ensemble du fil ; un membre RESTREINT ou BLOQUÉ n'y a pas
accès. L'audience d'un post reste un libellé optionnel, accessible à tout membre.
"""
from django.db.models import F

from .models import Audience, Comment, CommentLike, Like, Post


def _is_active_member(user) -> bool:
    from apps.billing.models import SubscriptionType
    from apps.billing.services import has_subscription_access
    return has_subscription_access(user, SubscriptionType.MEMBRE)


def accessible_audiences(user) -> set[str]:
    """Audiences que le membre peut voir/poster (RG-30) — toutes s'il est actif."""
    return set(Audience.values) if _is_active_member(user) else set()


def can_access_audience(user, audience: str) -> bool:
    return _is_active_member(user)


def toggle_like(user, post: Post) -> tuple[bool, int]:
    """Like / unlike d'un post (RG-29). Retourne (liké?, likes_count à jour)."""
    like = Like.objects.filter(post=post, user=user).first()
    if like:
        like.delete()
        Post.objects.filter(id=post.id, likes_count__gt=0).update(likes_count=F("likes_count") - 1)
        liked = False
    else:
        Like.objects.create(post=post, user=user)
        Post.objects.filter(id=post.id).update(likes_count=F("likes_count") + 1)
        liked = True
    post.refresh_from_db(fields=["likes_count"])
    return liked, post.likes_count


def toggle_comment_like(user, comment: Comment) -> tuple[bool, int]:
    """Like / unlike d'un commentaire. Retourne (liké?, likes_count à jour)."""
    like = CommentLike.objects.filter(comment=comment, user=user).first()
    if like:
        like.delete()
        liked = False
    else:
        CommentLike.objects.create(comment=comment, user=user)
        liked = True
    count = CommentLike.objects.filter(comment=comment).count()
    return liked, count


def share_post(user, origin: Post) -> Post:
    """Partage interne : nouveau post du membre référençant l'original (RG-34)."""
    return Post.objects.create(
        author=user,
        text=origin.text,
        image=origin.image,
        video=origin.video,
        audience=origin.audience,
        shared_from=origin,
    )
