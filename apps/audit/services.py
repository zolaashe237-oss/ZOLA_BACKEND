"""Écriture du journal d'audit (CDC §7.6).

Point d'entrée unique pour tracer toute action admin sensible. La table est
append-only (cf. AuditLog.save/delete) : on ne fait qu'insérer.
"""
from .models import AuditLog


def record(actor, action: str, *, target_type: str = "", target_id="",
           reason: str = "", payload: dict | None = None) -> AuditLog:
    """Enregistre une entrée d'audit. `actor` peut être None (action système)."""
    return AuditLog.objects.create(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id != "" else "",
        reason=reason or "",
        payload=payload or {},
    )
