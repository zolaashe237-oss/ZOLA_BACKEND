"""Commande d'initialisation (Bootstrap) pour la base de données de production ZOLA ASHÉ.

Idempotent et sûr pour la production :
- Crée ou met à jour le compte super-administrateur
- Initialise les réglages globaux (GlobalSettings)
- Initialise les canaux de discussion communautaires
- Initialise la liste des 10 ouvrages de la bibliothèque ZOLA ASHÉ

Usage :
    python manage.py bootstrap_prod
    python manage.py bootstrap_prod --email=monadmin@zola-ashe.com --password=MonMotDePasseFort123! --name="Nom Admin"
"""
import os
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import GlobalSettings, Role, User, UserStatus
from apps.community.models import CommunityChannel
from apps.content.models import AccessLevel, Branche, LibraryPdf


OFFICIAL_BOOKS = [
    (
        "Comprendre la spiritualité",
        "Les fondements de la spiritualité et les principes qui influencent la vie.",
        "Manuel",
    ),
    (
        "Libère-toi",
        "Se libérer des blocages intérieurs et des limitations qui empêchent d'avancer.",
        "Livret",
    ),
    (
        "Dominer mon année",
        "Préparer, organiser et diriger efficacement son année.",
        "Calendrier",
    ),
    (
        "Le pouvoir spirituel de la femme",
        "La puissance intérieure de la femme et son rôle dans l'équilibre de la société.",
        "Livret",
    ),
    (
        "Le secret ultime de la libation",
        "Les principes et la pratique de la libation, dans une approche consciente.",
        "Référence",
    ),
    (
        "Le guide secret du déblocage spirituel",
        "Comprendre certains blocages invisibles et les moyens de les dépasser.",
        "Manuel",
    ),
    (
        "Le pouvoir de la gratitude",
        "Comment la gratitude transforme l'état d'esprit et attire la bénédiction.",
        "Livret",
    ),
    (
        "Le principe de la bénédiction universelle",
        "Comment actes et intentions favorisent la circulation de la bénédiction.",
        "Référence",
    ),
    (
        "L'Afrique, notre identité",
        "La redécouverte de l'identité africaine et de ses racines.",
        "Histoire",
    ),
    (
        "Comprendre les cycles lunaires et leurs rituels",
        "L'influence des cycles lunaires et leur usage conscient.",
        "Calendrier",
    ),
]

CHANNELS = [
    {"name": "Général", "slug": "general", "description": "Échanges généraux de la communauté", "color": "#8B1A1A", "branche": Branche.MEMBRE},
    {"name": "Annonces officielles", "slug": "annonces", "description": "Communications officielles de l'école ZOLA ASHÉ", "color": "#C9A227", "branche": Branche.MEMBRE},
    {"name": "Cercle Féminin", "slug": "femme", "description": "Espace d'échange et d'élévation dédié aux femmes", "color": "#5B1A8B", "branche": Branche.FEMME},
    {"name": "Espace Jeunesse", "slug": "enfant", "description": "Activités et accompagnement pour les plus jeunes", "color": "#1B3A5C", "branche": Branche.ENFANT},
]


class Command(BaseCommand):
    help = "Initialise le compte administrateur et les données de base de production (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--email", type=str, default=os.getenv("ADMIN_EMAIL", "admin@zola-ashe.com"), help="Email de l'administrateur")
        parser.add_argument("--password", type=str, default=os.getenv("ADMIN_PASSWORD", "Admin12345!"), help="Mot de passe de l'administrateur")
        parser.add_argument("--name", type=str, default=os.getenv("ADMIN_FULL_NAME", "Coach Rodrigue DOUANLA"), help="Nom complet de l'administrateur")
        parser.add_argument("--phone", type=str, default=os.getenv("ADMIN_PHONE", "+237690000000"), help="Numéro WhatsApp/téléphone admin")

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        password = options["password"]
        full_name = options["name"].strip()
        phone = options["phone"].strip()

        self.stdout.write(self.style.NOTICE("─── Initialisation de la base de données de production ───"))

        # 1. Compte Administrateur
        admin_user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "full_name": full_name,
                "role": Role.ADMIN,
                "status": UserStatus.ACTIF,
                "email_verified": True,
                "is_staff": True,
                "is_superuser": True,
                "phone": phone,
            },
        )
        if not created:
            admin_user.full_name = full_name
            admin_user.role = Role.ADMIN
            admin_user.status = UserStatus.ACTIF
            admin_user.email_verified = True
            admin_user.is_staff = True
            admin_user.is_superuser = True
            if phone:
                admin_user.phone = phone
        admin_user.set_password(password)
        admin_user.save()

        action_str = "Créé" if created else "Mis à jour"
        self.stdout.write(self.style.SUCCESS(f"✓ Super-Administrateur [{email}] {action_str} avec succès."))

        # 2. Paramètres Globaux (GlobalSettings)
        gs, _ = GlobalSettings.objects.get_or_create(id=1)
        if not gs.admin_whatsapp and phone:
            gs.admin_whatsapp = phone
        if not gs.youtube_url:
            gs.youtube_url = "https://www.youtube.com/@zolaashe"
        gs.save()
        self.stdout.write(self.style.SUCCESS("✓ Paramètres globaux (WhatsApp & Réseaux) configurés."))

        # 3. Canaux communautaires
        created_channels = 0
        for ch_data in CHANNELS:
            _, ch_created = CommunityChannel.objects.get_or_create(
                slug=ch_data["slug"],
                defaults={
                    "name": ch_data["name"],
                    "description": ch_data["description"],
                    "color": ch_data["color"],
                    "branche": ch_data["branche"],
                    "is_active": True,
                },
            )
            if ch_created:
                created_channels += 1
        self.stdout.write(self.style.SUCCESS(f"✓ Canaux communautaires initialisés ({created_channels} nouveaux créés)."))

        # 4. Bibliothèque (10 ouvrages de référence)
        created_books = 0
        for title, desc, _cat in OFFICIAL_BOOKS:
            _, b_created = LibraryPdf.objects.get_or_create(
                title=title,
                defaults={
                    "description": desc,
                    "access_level": AccessLevel.MEMBRE,
                    "is_active": True,
                    "nb_pages": 40,
                },
            )
            if b_created:
                created_books += 1
        self.stdout.write(self.style.SUCCESS(f"✓ Ouvrages de la bibliothèque initialisés ({created_books} nouveaux créés)."))

        self.stdout.write(self.style.SUCCESS("\n🎉 Bootstrap de production terminé avec succès !"))
        self.stdout.write(self.style.NOTICE(f"Identifiants de connexion : {email} / {'*' * len(password)}"))
