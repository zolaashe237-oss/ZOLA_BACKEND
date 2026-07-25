"""Seed de démonstration ZOLA ASHÉ — données de consultation (idempotent).

Fidèle au livret : un admin, un membre démo (droit d'inscription réglé +
cotisation à jour → ACTIF), des formations organisées en modules (arborescence)
contenant des cours (avec ressources : vidéos YouTube/fichiers, PDF, audio) et
des QCM (par cours + examen final), une formation en accès libre, une formation
programmée, des publications et des articles. Lancer :

    python manage.py seed_demo
"""
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import Role, User, UserStatus
from apps.billing.models import (
    Payment,
    PaymentStatus,
    PaymentType,
    Subscription,
    SubscriptionType,
)
from apps.blog.models import Article
from apps.community.models import Audience, Post
from apps.content.models import (
    Category,
    Choice,
    Course,
    Formation,
    FormationStatus,
    Module,
    Question,
    Quiz,
    Resource,
    ResourceType,
    VideoSource,
    LiveSession,
)

MEMBRE = ["MEMBRE"]  # accès réservé aux membres actifs
LIBRE: list[str] = []  # accès libre (public)

# Vidéo YouTube de démonstration (placeholder neutre, remplaçable en back-office).
YT_DEMO = "https://www.youtube.com/watch?v=ScMzIvxBSi4"


def thumb(seed: str) -> str:
    return f"https://picsum.photos/seed/{seed}/480/300"


# Bibliothèque du membre (livret §11) — 10 ouvrages, en PDF.
LIVRES = [
    ("Comprendre la spiritualité", "Les fondements de la spiritualité et les principes qui influencent la vie."),
    ("Libère-toi", "Se libérer des blocages intérieurs et des limitations qui empêchent d'avancer."),
    ("Dominer mon année", "Préparer, organiser et diriger efficacement son année."),
    ("Le pouvoir spirituel de la femme", "La puissance intérieure de la femme et son rôle dans l'équilibre de la société."),
    ("Le secret ultime de la libation", "Les principes et la pratique de la libation, dans une approche consciente."),
    ("Le guide secret du déblocage spirituel", "Comprendre certains blocages invisibles et les moyens de les dépasser."),
    ("Le pouvoir de la gratitude", "Comment la gratitude transforme l'état d'esprit et attire la bénédiction."),
    ("Le principe de la bénédiction universelle", "Comment actes et intentions favorisent la circulation de la bénédiction."),
    ("L'Afrique, notre identité", "La redécouverte de l'identité africaine et de ses racines."),
    ("Comprendre les cycles lunaires et leurs rituels", "L'influence des cycles lunaires et leur usage conscient."),
]

POSTS = [
    "Bienvenue dans la communauté ZOLA ASHÉ 🌍 Que l'amour que nous portons devienne une force de transformation.",
    "Séance hebdomadaire ce vendredi de 20h à 22h (GMT+1). On vous attend nombreux !",
    "Nouvelle formation du mois en ligne : pensez à l'ajouter à votre parcours.",
    "Rappel : le coaching privé de 30 min avec le fondateur est offert à chaque nouveau membre.",
]

ARTICLES = [
    ("Comprendre l'Ashé : la force qui anime toute chose", "Spiritualité",
     "Aux racines de la tradition, l'Ashé désigne l'énergie vitale présente en chacun de nous.",
     "blog1",
     "L'Ashé est ce souffle qui relie l'humain au vivant.\n\nDans la tradition, cultiver son Ashé, "
     "c'est aligner ses actes, ses paroles et son intention.\n\nCe premier article vous invite à un "
     "voyage intérieur, à la rencontre de cette force qui éveille votre parcours."),
    ("Le retour aux sources : retrouver son identité", "Identité",
     "Se reconnecter à son héritage et à la sagesse de nos ancêtres méritants pour avancer en conscience.",
     "blog2",
     "Beaucoup vivent coupés de leurs racines.\n\nLe retour aux sources n'est pas une nostalgie : c'est "
     "une force.\n\nComprendre d'où l'on vient éclaire le chemin que l'on choisit."),
    ("La discipline, socle de la transformation", "Développement",
     "La transformation exige constance et rigueur : structurer sa vie pour progresser durablement.",
     "blog3",
     "La discipline n'enferme pas, elle libère.\n\nElle donne un cadre à l'intention et transforme les "
     "résolutions en habitudes.\n\nVoici comment l'installer pas à pas."),
    ("Pourquoi un parcours progressif change tout", "Pédagogie",
     "Avancer étape par étape, valider ses acquis : la clé d'un apprentissage qui s'ancre durablement.",
     "blog4",
     "Le déverrouillage progressif n'est pas une contrainte, c'est un rythme.\n\nIl respecte votre "
     "cheminement et consolide chaque acquis avant le suivant."),
]


def _make_quiz(*, title, questions, course=None, formation=None, threshold=15) -> Quiz:
    """Crée un QCM (rattaché à un cours OU à une formation) avec ses questions/options.

    `questions` : liste de (énoncé, [(option, est_correcte), ...]).
    """
    quiz = Quiz.objects.create(course=course, formation=formation, title=title, pass_threshold=threshold)
    for qi, (text, options) in enumerate(questions, start=1):
        question = Question.objects.create(quiz=quiz, text=text, order=qi)
        Choice.objects.bulk_create([
            Choice(question=question, text=opt, is_correct=ok, order=ci)
            for ci, (opt, ok) in enumerate(options, start=1)
        ])
    return quiz


def _demo_questions(theme: str):
    """Petit QCM générique de démonstration (3 questions, une bonne réponse chacune)."""
    return [
        (f"Quel est le principe central abordé dans « {theme} » ?",
         [("L'alignement entre intention, parole et acte", True),
          ("L'accumulation de richesses matérielles", False),
          ("L'imitation des autres", False)]),
        ("Quelle posture favorise la progression spirituelle ?",
         [("La constance et la discipline", True),
          ("L'impatience", False),
          ("Le découragement", False)]),
        ("Que permet le déverrouillage progressif des cours ?",
         [("D'ancrer chaque acquis avant le suivant", True),
          ("De sauter les étapes", False),
          ("De tout débloquer sans effort", False)]),
    ]


def _video_course(module, order, title, desc, seed) -> Course:
    """Cours vidéo (YouTube) + QCM, rattaché à un module."""
    course = Course.objects.create(module=module, title=title, description=desc, order=order)
    Resource.objects.create(
        course=course, resource_type=ResourceType.VIDEO, video_source=VideoSource.YOUTUBE,
        youtube_url=YT_DEMO, title=f"Vidéo — {title}", description=desc, order=1,
        thumbnail_url=thumb(seed),
    )
    _make_quiz(course=course, title=f"QCM — {title}", questions=_demo_questions(title))
    return course


class Command(BaseCommand):
    help = "Crée des données de démonstration pour la consultation."

    def handle(self, *args, **options):
        today = timezone.now().date()

        # --- Admin ---
        admin, _ = User.objects.get_or_create(
            email="admin@zola-ashe.com",
            defaults={"full_name": "Coach Rodrigue DOUANLA", "role": Role.ADMIN},
        )
        admin.role = Role.ADMIN
        admin.full_name = "Coach Rodrigue DOUANLA"
        admin.email_verified = True
        admin.is_staff = True
        admin.status = UserStatus.ACTIF
        admin.set_password("Admin12345!")
        admin.save()

        # --- Membre démo : inscription réglée + cotisation à jour → ACTIF ---
        demo, _ = User.objects.get_or_create(
            email="demo@zola-ashe.com",
            defaults={"full_name": "Membre Démo", "role": Role.MEMBER},
        )
        demo.full_name = "Membre Démo"
        demo.email_verified = True
        demo.status = UserStatus.ACTIF
        demo.set_password("Demo12345!")
        demo.save()

        # Adhésion propre et déterministe (on repart de zéro pour la démo).
        Payment.objects.filter(user=demo).delete()
        Subscription.objects.filter(user=demo).delete()
        # Échéance d'accès courante : cotisation à jour (30 jours restants).
        sub = Subscription.objects.create(
            user=demo, type=SubscriptionType.MEMBRE, start=today,
            end=today + timedelta(days=settings.COTISATION_PERIOD_DAYS), active=True)
        Payment.objects.create(user=demo, subscription=sub, type=PaymentType.INSCRIPTION,
                               status=PaymentStatus.VALIDE, amount=10000, reason="Seed démo")
        Payment.objects.create(user=demo, type=PaymentType.COTISATION,
                               status=PaymentStatus.VALIDE, amount=2000, reason="Seed démo")

        # --- Catalogue : on reconstruit l'arborescence à chaque seed ---
        Formation.objects.all().delete()  # cascade modules / cours / ressources / quizzes
        LiveSession.objects.all().delete()

        # 1) Programme phare — formation réservée, modules hiérarchiques + examen final
        programme = Formation.objects.create(
            title="Programme — Préparer, posséder et dominer une année",
            description="Le programme phare pour structurer ses objectifs et diriger son année, "
                        "module après module.",
            category=Category.FORMATION, access_subscription_types=MEMBRE,
            status=FormationStatus.PUBLISHED, cover_url=thumb("programme"), order=1,
        )
        # Module « Préparer » → sous-module « Fondations » → 2 cours
        preparer = Module.objects.create(formation=programme, title="Préparer",
                                         description="Poser des fondations claires avant d'agir.", order=1)
        fondations = Module.objects.create(formation=programme, parent=preparer, title="Fondations",
                                           description="Faire de la place pour la transformation.", order=1)
        _video_course(fondations, 1, "Clarifier ses intentions", "Définir un cap aligné et sincère.", "prog11")
        _video_course(fondations, 2, "Préparer son espace intérieur", "Se rendre disponible au changement.", "prog12")
        # Module « Posséder » → 1 cours direct
        posseder = Module.objects.create(formation=programme, title="Posséder",
                                         description="S'approprier ses objectifs et ses moyens.", order=2)
        _video_course(posseder, 1, "S'engager pleinement", "Transformer l'intention en décision.", "prog21")
        # Module « Dominer » → 1 cours
        dominer = Module.objects.create(formation=programme, title="Dominer",
                                        description="Diriger son année avec constance.", order=3)
        _video_course(dominer, 1, "Tenir le cap", "Maintenir l'effort dans la durée.", "prog31")
        # Examen final
        _make_quiz(formation=programme, title="Examen final — Programme annuel",
                   questions=_demo_questions("le programme annuel"), threshold=15)

        # 2) Formation courte — réservée, modules linéaires (un cours par jour)
        libation = Formation.objects.create(
            title="07 jours pour comprendre et pratiquer sainement la libation",
            description="Les fondements de la libation, pratiquée de manière équilibrée.",
            category=Category.FORMATION, access_subscription_types=MEMBRE,
            status=FormationStatus.PUBLISHED, cover_url=thumb("libation"), order=2,
        )
        for di in range(1, 4):
            m = Module.objects.create(formation=libation, title=f"Jour {di}", order=di,
                                      description=f"Étape {di} du parcours.")
            _video_course(m, 1, f"Leçon du jour {di}", f"Contenu du jour {di}.", f"lib{di}")

        # 3) Bibliothèque — formation réservée en lecture (PDF), sans QCM
        biblio = Formation.objects.create(
            title="Bibliothèque ZOLA ASHÉ",
            description="Les ouvrages remis aux membres dès leur intégration.",
            category=Category.LIVRE, access_subscription_types=MEMBRE,
            status=FormationStatus.PUBLISHED, cover_url=thumb("biblio"), order=3,
        )
        ouvrages = Module.objects.create(formation=biblio, title="Les ouvrages", order=1)
        for li, (title, desc) in enumerate(LIVRES, start=1):
            course = Course.objects.create(module=ouvrages, title=title, description=desc, order=li)
            Resource.objects.create(
                course=course, resource_type=ResourceType.PDF, title=title, description=desc,
                order=1, bucket_key="", nb_pages=40, thumbnail_url=thumb(f"livre{li}"),
            )

        # 4) Accès libre — formation publique (audio)
        libre = Formation.objects.create(
            title="Méditation guidée du matin",
            description="Une séance audio en accès libre pour bien commencer la journée.",
            category=Category.LIBRE, access_subscription_types=LIBRE,
            status=FormationStatus.PUBLISHED, cover_url=thumb("libre1"), order=1,
        )
        m_libre = Module.objects.create(formation=libre, title="Séance du matin", order=1)
        c_libre = Course.objects.create(module=m_libre, title="Méditation (10 min)", order=1)
        Resource.objects.create(
            course=c_libre, resource_type=ResourceType.AUDIO, title="Méditation (10 min)",
            order=1, duration_sec=600, audio_format="MP3", thumbnail_url=thumb("libre1"),
        )

        # 5) Formation PROGRAMMÉE — démonstration de la publication différée (visible J+7)
        Formation.objects.create(
            title="Les secrets de la loi d'attraction (bientôt disponible)",
            description="Nouvelle formation programmée : mise en ligne automatique à la date prévue.",
            category=Category.FORMATION, access_subscription_types=MEMBRE,
            status=FormationStatus.SCHEDULED, publish_at=timezone.now() + timedelta(days=7),
            cover_url=thumb("attraction"), order=4,
        )

        # --- Communauté (audience unique : TOUS) ---
        for text in POSTS:
            Post.objects.get_or_create(
                author=admin, text=text, audience=Audience.TOUS,
                defaults={"active": True},
            )

        # --- Blog / Journal ---
        for title, cat, excerpt, seed, body in ARTICLES:
            art, _ = Article.objects.get_or_create(
                title=title,
                defaults={"excerpt": excerpt, "body": body, "category": cat,
                          "cover_url": f"https://picsum.photos/seed/{seed}/800/450",
                          "author": admin, "published": True},
            )
            if not art.published:
                art.published = True
                art.save()

        # --- Sessions en direct ---
        LiveSession.objects.create(
            title="Session hebdomadaire — Méditation collective",
            description="Méditation guidée pour aligner votre énergie et vous connecter à la communauté ZOLA ASHÉ.",
            start_at=timezone.now() + timedelta(days=4),
            duration_minutes=60,
            trainer="Coach Rodrigue DOUANLA",
            platform=LiveSession.Platform.YOUTUBE,
            status=LiveSession.Status.UPCOMING,
            link="https://www.youtube.com/watch?v=ScMzIvxBSi4",
            tags=["Méditation", "Général"],
        )
        LiveSession.objects.create(
            title="Cercle féminin — La Femme Lumière",
            description="Espace de parole et de transmission dédié aux femmes de la communauté.",
            start_at=timezone.now() + timedelta(days=6),
            duration_minutes=90,
            trainer="Responsable Branche Femme",
            platform=LiveSession.Platform.ZOOM,
            status=LiveSession.Status.UPCOMING,
            link="https://zoom.us/j/demo12345",
            tags=["Branche Femme", "Cercle"],
        )
        LiveSession.objects.create(
            title="Questions-Réponses — Les 7 Principes",
            description="Session interactive autour des sept principes fondamentaux de l'Ashé.",
            start_at=timezone.now() - timedelta(days=24),
            duration_minutes=45,
            trainer="Coach Rodrigue DOUANLA",
            platform=LiveSession.Platform.YOUTUBE,
            status=LiveSession.Status.REPLAY,
            link="https://www.youtube.com/watch?v=ScMzIvxBSi4",
            tags=["Q&R", "Général"],
        )
        LiveSession.objects.create(
            title="Initiation — Comprendre l'Ashé",
            description="Introduction aux fondements spirituels africains pour les nouveaux membres.",
            start_at=timezone.now() - timedelta(days=31),
            duration_minutes=75,
            trainer="Coach Rodrigue DOUANLA",
            platform=LiveSession.Platform.YOUTUBE,
            status=LiveSession.Status.REPLAY,
            link="https://www.youtube.com/watch?v=ScMzIvxBSi4",
            tags=["Initiation", "Général"],
        )
        LiveSession.objects.create(
            title="Branche Enfant — Contes sacrés d'Afrique",
            description="Session de contes africains animée pour les parents et leurs enfants.",
            start_at=timezone.now() - timedelta(days=41),
            duration_minutes=50,
            trainer="Équipe Branche Enfant",
            platform=LiveSession.Platform.ZOOM,
            status=LiveSession.Status.REPLAY,
            link="https://zoom.us/j/demo12345",
            tags=["Branche Enfant", "Conte"],
        )

        self.stdout.write(self.style.SUCCESS(
            f"Seed OK — admin admin@zola-ashe.com / Admin12345!, "
            f"membre demo@zola-ashe.com / Demo12345!, "
            f"{Formation.objects.count()} formations, {Module.objects.count()} modules, "
            f"{Course.objects.count()} cours, {Resource.objects.count()} ressources, "
            f"{Quiz.objects.count()} QCM, {Post.objects.count()} posts, {Article.objects.count()} articles, "
            f"{LiveSession.objects.count()} lives."
        ))
