"""Répare les comptes restés RESTREINT après une « inscription mensuelle » payée.

Avant correctif, un 1er paiement COTISATION d'un non-adhérent (offre « Accès
mensuel » à l'inscription, ou validation manuelle admin « Inscription mensuelle »)
était encaissé sans ouvrir d'adhésion : le compte restait RESTREINT.

Pour chaque compte concerné, l'adhésion est recréée avec l'échéance qu'auraient
produite ses cotisations validées (30 j chacune, cumulables). Le membre redevient
ACTIF si cette échéance (+ délai de grâce) n'est pas dépassée, ou si la cotisation
mensuelle est désactivée. Les paiements ne sont pas modifiés (append-only, RG-36).

    python manage.py repair_monthly_memberships            # aperçu, rien n'est modifié
    python manage.py repair_monthly_memberships --apply    # applique
"""
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.features import monthly_subscription_enabled
from apps.accounts.models import Role, User, UserStatus
from apps.billing.models import Payment, PaymentStatus, PaymentType, Subscription, SubscriptionType


class Command(BaseCommand):
    help = "Ouvre l'adhésion des membres ayant payé une cotisation mensuelle sans adhésion active."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="Applique les corrections (sans cette option : simple aperçu).")

    def handle(self, *args, apply=False, **options):
        today = timezone.now().date()
        period = timedelta(days=settings.COTISATION_PERIOD_DAYS)
        grace = timedelta(days=settings.COTISATION_GRACE_DAYS)
        monthly_on = monthly_subscription_enabled()

        members_with_sub = Subscription.objects.filter(
            type=SubscriptionType.MEMBRE, active=True).values("user_id")
        candidates = (User.objects
                      .filter(role=Role.MEMBER, status=UserStatus.RESTREINT,
                              payments__type=PaymentType.COTISATION,
                              payments__status=PaymentStatus.VALIDE)
                      .exclude(id__in=members_with_sub)
                      .distinct().order_by("id"))

        repaired = 0
        for user in candidates:
            dates = list(Payment.objects
                         .filter(user=user, type=PaymentType.COTISATION, status=PaymentStatus.VALIDE)
                         .order_by("paid_at").values_list("paid_at", flat=True))
            # Même cumul que extend_subscription : on prolonge depuis l'échéance si elle
            # court encore à la date du paiement, sinon depuis la date du paiement.
            end = None
            for paid_at in dates:
                day = paid_at.date()
                end = (end if end and end >= day else day) + period
            reactivate = not monthly_on or end + grace >= today
            self.stdout.write(
                f"#{user.id} {user.email} — {len(dates)} cotisation(s), échéance {end:%d/%m/%Y} → "
                f"{'ACTIF' if reactivate else 'reste RESTREINT (échéance dépassée, peut maintenant cotiser)'}")

            if apply:
                with transaction.atomic():
                    Subscription.objects.create(user=user, type=SubscriptionType.MEMBRE,
                                                start=dates[0].date(), end=end, active=True)
                    levels = list(user.access_levels or [])
                    if "MEMBRE" not in levels:
                        user.access_levels = [*levels, "MEMBRE"]
                        user.save(update_fields=["access_levels"])
                    if reactivate:
                        user.set_status(UserStatus.ACTIF)
            repaired += 1

        verb = "réparé(s)" if apply else "à réparer — relancez avec --apply"
        self.stdout.write(self.style.SUCCESS(f"{repaired} compte(s) {verb}."))
